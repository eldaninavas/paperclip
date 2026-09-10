data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" { state = "available" }

locals {
  short_environment = var.environment == "production" ? "prod" : "dev"
  name              = "foundation-${local.short_environment}"
  azs               = slice(data.aws_availability_zones.available.names, 0, 2)
  image             = "${var.ecr_repository_url}:bootstrap"
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${local.name}-vpc" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${local.name}-igw" }
}

resource "aws_subnet" "application" {
  count                   = 2
  vpc_id                  = aws_vpc.this.id
  availability_zone       = local.azs[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.name}-app-egress-${count.index + 1}", Tier = "application" }
}

resource "aws_subnet" "data" {
  count                   = 2
  vpc_id                  = aws_vpc.this.id
  availability_zone       = local.azs[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index + 8)
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.name}-data-${count.index + 1}", Tier = "data" }
}

resource "aws_route_table" "application" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "${local.name}-application-egress" }
}

resource "aws_route_table_association" "application" {
  count          = 2
  subnet_id      = aws_subnet.application[count.index].id
  route_table_id = aws_route_table.application.id
}

resource "aws_route_table" "data" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${local.name}-data-no-internet" }
}

resource "aws_route_table_association" "data" {
  count          = 2
  subnet_id      = aws_subnet.data[count.index].id
  route_table_id = aws_route_table.data.id
}

resource "aws_security_group" "application" {
  name        = "${local.name}-application"
  description = "Foundation tasks: no inbound traffic; Cloudflare Tunnel is outbound"
  vpc_id      = aws_vpc.this.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "database" {
  name        = "${local.name}-database"
  description = "PostgreSQL from Foundation tasks only"
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.application.id]
  }
}

resource "aws_security_group" "filesystem" {
  name        = "${local.name}-filesystem"
  description = "NFS from Foundation tasks only"
  vpc_id      = aws_vpc.this.id

  ingress {
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.application.id]
  }
}

resource "random_password" "database" {
  length  = 32
  special = false
}

resource "random_password" "auth" {
  length  = 64
  special = false
}

resource "random_password" "secrets_master_key" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "this" {
  name       = "${local.name}-data"
  subnet_ids = aws_subnet.data[*].id
}

resource "aws_db_instance" "this" {
  identifier                      = "${local.name}-postgres"
  engine                          = "postgres"
  engine_version                  = "17"
  instance_class                  = var.database_instance_class
  db_name                         = "foundation"
  username                        = "foundation"
  password                        = random_password.database.result
  port                            = 5432
  allocated_storage               = var.database_allocated_storage
  max_allocated_storage           = var.database_max_allocated_storage
  storage_type                    = "gp3"
  storage_encrypted               = true
  multi_az                        = var.database_multi_az
  publicly_accessible             = false
  db_subnet_group_name            = aws_db_subnet_group.this.name
  vpc_security_group_ids          = [aws_security_group.database.id]
  backup_retention_period         = var.database_backup_retention_days
  auto_minor_version_upgrade      = true
  deletion_protection             = var.database_deletion_protection
  skip_final_snapshot             = var.environment != "production"
  final_snapshot_identifier       = var.environment == "production" ? "${local.name}-final" : null
  performance_insights_enabled    = true
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  apply_immediately               = var.environment != "production"
}

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "foundation/${var.environment}/database-url"
  recovery_window_in_days = var.environment == "production" ? 30 : 7
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql://foundation:${random_password.database.result}@${aws_db_instance.this.address}:5432/foundation"
}

resource "aws_secretsmanager_secret" "auth" {
  name                    = "foundation/${var.environment}/better-auth-secret"
  recovery_window_in_days = var.environment == "production" ? 30 : 7
}

resource "aws_secretsmanager_secret_version" "auth" {
  secret_id     = aws_secretsmanager_secret.auth.id
  secret_string = random_password.auth.result
}

resource "aws_secretsmanager_secret" "master_key" {
  name                    = "foundation/${var.environment}/secrets-master-key"
  recovery_window_in_days = var.environment == "production" ? 30 : 7
}

resource "aws_secretsmanager_secret_version" "master_key" {
  secret_id     = aws_secretsmanager_secret.master_key.id
  secret_string = random_password.secrets_master_key.result
}

resource "aws_secretsmanager_secret" "cloudflare_tunnel_token" {
  name                    = "foundation/${var.environment}/cloudflare-tunnel-token"
  recovery_window_in_days = var.environment == "production" ? 30 : 7
  description             = "Populated out-of-band after the Cloudflare Tunnel is created"
}

resource "aws_efs_file_system" "this" {
  encrypted       = true
  throughput_mode = "bursting"
  tags            = { Name = "${local.name}-data" }

  lifecycle_policy { transition_to_ia = "AFTER_30_DAYS" }
}

resource "aws_efs_mount_target" "this" {
  count           = 2
  file_system_id  = aws_efs_file_system.this.id
  subnet_id       = aws_subnet.data[count.index].id
  security_groups = [aws_security_group.filesystem.id]
}

resource "aws_efs_access_point" "this" {
  file_system_id = aws_efs_file_system.this.id
  posix_user {
    uid = 1000
    gid = 1000
  }
  root_directory {
    path = "/foundation"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "0750"
    }
  }
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${local.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_ecs_cluster" "this" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_iam_role" "execution" {
  name = "${local.name}-ecs-execution"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-environment-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.database_url.arn,
        aws_secretsmanager_secret.auth.arn,
        aws_secretsmanager_secret.master_key.arn,
        aws_secretsmanager_secret.cloudflare_tunnel_token.arn
      ]
    }]
  })
}

resource "aws_iam_role" "task" {
  name = "${local.name}-ecs-task"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_ecs_task_definition" "this" {
  family                   = local.name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.ecs_cpu)
  memory                   = tostring(var.ecs_memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  volume {
    name = "foundation-data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.this.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.this.id
        iam             = "DISABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name         = "foundation"
      image        = local.image
      essential    = true
      portMappings = [{ containerPort = 3100, protocol = "tcp" }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "HOST", value = "0.0.0.0" },
        { name = "PORT", value = "3100" },
        { name = "SERVE_UI", value = "true" },
        { name = "PAPERCLIP_HOME", value = "/paperclip" },
        { name = "PAPERCLIP_INSTANCE_ID", value = "default" },
        { name = "PAPERCLIP_CONFIG", value = "/paperclip/instances/default/config.json" },
        { name = "PAPERCLIP_DEPLOYMENT_MODE", value = "authenticated" },
        { name = "PAPERCLIP_DEPLOYMENT_EXPOSURE", value = "public" },
        { name = "PAPERCLIP_PUBLIC_URL", value = "https://${var.domain_name}" },
        { name = "PAPERCLIP_ALLOWED_HOSTNAMES", value = var.domain_name },
        { name = "PAPERCLIP_MIGRATION_AUTO_APPLY", value = "true" },
        { name = "PAPERCLIP_AUTH_RATE_LIMIT_ENABLED", value = "true" },
        { name = "HEARTBEAT_SCHEDULER_ENABLED", value = "true" }
      ]
      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
        { name = "BETTER_AUTH_SECRET", valueFrom = aws_secretsmanager_secret.auth.arn },
        { name = "PAPERCLIP_SECRETS_MASTER_KEY", valueFrom = aws_secretsmanager_secret.master_key.arn }
      ]
      mountPoints = [{ sourceVolume = "foundation-data", containerPath = "/paperclip", readOnly = false }]
      healthCheck = {
        command     = ["CMD-SHELL", "curl -fsS http://127.0.0.1:3100/api/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 90
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.this.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "foundation"
        }
      }
    },
    {
      name      = "cloudflared"
      image     = "cloudflare/cloudflared@sha256:ff69a2225ad7c6f85ed84fbd5f3087df46202426b2388ec60214098e0adf05e9"
      essential = true
      command   = ["tunnel", "--no-autoupdate", "run"]
      secrets   = [{ name = "TUNNEL_TOKEN", valueFrom = aws_secretsmanager_secret.cloudflare_tunnel_token.arn }]
      dependsOn = [{ containerName = "foundation", condition = "HEALTHY" }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.this.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "cloudflared"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "this" {
  name            = local.name
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  enable_execute_command             = false
  propagate_tags                     = "SERVICE"

  network_configuration {
    subnets          = aws_subnet.application[*].id
    security_groups  = [aws_security_group.application.id]
    assign_public_ip = true
  }

  lifecycle { ignore_changes = [task_definition, desired_count] }
  depends_on = [aws_efs_mount_target.this]
}

resource "aws_iam_role" "github_deploy" {
  name = "${local.name}-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = var.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:${var.environment}"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "deploy-foundation-${local.short_environment}"
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:CompleteLayerUpload", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart", "ecr:BatchGetImage"]
        Resource = var.ecr_repository_arn
      },
      {
        Effect   = "Allow"
        Action   = ["ecs:DescribeServices", "ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition", "ecs:UpdateService"]
        Resource = "*"
      },
      {
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = [aws_iam_role.execution.arn, aws_iam_role.task.arn]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      }
    ]
  })
}

output "vpc_id" { value = aws_vpc.this.id }
output "private_application_subnets" { value = aws_subnet.application[*].id }
output "private_data_subnets" { value = aws_subnet.data[*].id }
output "ecs_cluster_name" { value = aws_ecs_cluster.this.name }
output "ecs_service_name" { value = aws_ecs_service.this.name }
output "ecs_task_family" { value = aws_ecs_task_definition.this.family }
output "github_deploy_role_arn" { value = aws_iam_role.github_deploy.arn }
output "cloudflare_tunnel_secret_arn" { value = aws_secretsmanager_secret.cloudflare_tunnel_token.arn }
output "domain_name" { value = var.domain_name }
