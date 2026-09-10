resource "aws_vpc" "this" {
  cidr_block                       = var.vpc_cidr
  assign_generated_ipv6_cidr_block = true
  enable_dns_support               = true
  enable_dns_hostnames             = true
  tags                             = { Name = "foundation-vpc" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "foundation-igw" }
}

resource "aws_subnet" "application" {
  count                           = 2
  vpc_id                          = aws_vpc.this.id
  availability_zone               = local.azs[count.index]
  cidr_block                      = cidrsubnet(var.vpc_cidr, 4, count.index)
  ipv6_cidr_block                 = cidrsubnet(aws_vpc.this.ipv6_cidr_block, 8, count.index)
  assign_ipv6_address_on_creation = true
  map_public_ip_on_launch         = false
  tags                            = { Name = "foundation-app-${count.index + 1}", Tier = "application" }
}

resource "aws_subnet" "data" {
  count                   = 2
  vpc_id                  = aws_vpc.this.id
  availability_zone       = local.azs[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index + 8)
  map_public_ip_on_launch = false
  tags                    = { Name = "foundation-data-${count.index + 1}", Tier = "data" }
}

resource "aws_route_table" "application" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  route {
    ipv6_cidr_block = "::/0"
    gateway_id      = aws_internet_gateway.this.id
  }
  tags = { Name = "foundation-application" }
}

resource "aws_route_table_association" "application" {
  count          = 2
  subnet_id      = aws_subnet.application[count.index].id
  route_table_id = aws_route_table.application.id
}

resource "aws_route_table" "data" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "foundation-data-no-internet" }
}

resource "aws_route_table_association" "data" {
  count          = 2
  subnet_id      = aws_subnet.data[count.index].id
  route_table_id = aws_route_table.data.id
}

resource "aws_security_group" "load_balancer" {
  name        = "foundation-alb"
  description = "HTTPS only from Cloudflare IPv6 origin ranges"
  vpc_id      = aws_vpc.this.id
  ingress {
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    ipv6_cidr_blocks = var.cloudflare_ipv6_cidrs
  }
}

resource "aws_security_group" "application" {
  for_each    = local.environments
  name        = "foundation-${each.value.short}-application"
  description = "Foundation ${each.key}: inbound only from shared ALB"
  vpc_id      = aws_vpc.this.id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_vpc_security_group_ingress_rule" "application_from_alb" {
  for_each                     = local.environments
  security_group_id            = aws_security_group.application[each.key].id
  referenced_security_group_id = aws_security_group.load_balancer.id
  from_port                    = 3100
  to_port                      = 3100
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_application" {
  for_each                     = local.environments
  security_group_id            = aws_security_group.load_balancer.id
  referenced_security_group_id = aws_security_group.application[each.key].id
  from_port                    = 3100
  to_port                      = 3100
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "database" {
  name        = "foundation-prod-database"
  description = "PostgreSQL from production only"
  vpc_id      = aws_vpc.this.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.application["production"].id]
  }
}

resource "aws_security_group" "filesystem" {
  name        = "foundation-filesystem"
  description = "NFS from Foundation tasks only"
  vpc_id      = aws_vpc.this.id
  ingress {
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = values(aws_security_group.application)[*].id
  }
}

resource "aws_lb" "this" {
  name               = "foundation"
  internal           = false
  load_balancer_type = "application"
  ip_address_type    = "dualstack-without-public-ipv4"
  security_groups    = [aws_security_group.load_balancer.id]
  subnets            = aws_subnet.application[*].id
}

resource "aws_lb_target_group" "environment" {
  for_each    = local.environments
  name        = "foundation-${each.value.short}"
  port        = 3100
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.this.id
  health_check {
    path                = "/api/health"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "environment" {
  for_each     = local.environments
  listener_arn = aws_lb_listener.https.arn
  priority     = each.key == "production" ? 100 : 200
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.environment[each.key].arn
  }
  condition {
    host_header { values = [each.value.domain] }
  }
}
