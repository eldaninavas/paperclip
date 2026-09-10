resource "aws_cloudwatch_log_group" "environment" {
  for_each          = local.environments
  name              = "/ecs/foundation-${each.value.short}"
  retention_in_days = each.key == "production" ? 30 : 7
}

resource "aws_ecs_cluster" "this" {
  name = "foundation"
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_ecs_task_definition" "environment" {
  for_each                 = local.environments
  family                   = "foundation-${each.value.short}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(each.key == "production" ? var.production_ecs_cpu : var.development_ecs_cpu)
  memory                   = tostring(each.key == "production" ? var.production_ecs_memory : var.development_ecs_memory)
  execution_role_arn       = aws_iam_role.execution[each.key].arn
  task_role_arn            = aws_iam_role.task[each.key].arn
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
        access_point_id = aws_efs_access_point.environment[each.key].id
        iam             = "DISABLED"
      }
    }
  }

  container_definitions = jsonencode(concat([{
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
      # Cloudflare Access is the public identity boundary. Inside that boundary,
      # Foundation may safely enroll the first authenticated administrator in-browser.
      { name = "PAPERCLIP_DEPLOYMENT_EXPOSURE", value = "private" },
      { name = "PAPERCLIP_PUBLIC_URL", value = "https://${each.value.domain}" },
      { name = "PAPERCLIP_ALLOWED_HOSTNAMES", value = each.value.domain },
      { name = "PAPERCLIP_MIGRATION_AUTO_APPLY", value = "true" },
      { name = "PAPERCLIP_AUTH_RATE_LIMIT_ENABLED", value = "true" },
      { name = "FOUNDATION_CLOUD_EXECUTION", value = "true" },
      { name = "HEARTBEAT_SCHEDULER_ENABLED", value = "true" }
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url[each.key].arn },
      { name = "BETTER_AUTH_SECRET", valueFrom = aws_secretsmanager_secret.auth[each.key].arn },
      { name = "PAPERCLIP_SECRETS_MASTER_KEY", valueFrom = aws_secretsmanager_secret.master_key[each.key].arn }
    ]
    mountPoints      = [{ sourceVolume = "foundation-data", containerPath = "/paperclip", readOnly = false }]
    healthCheck      = { command = ["CMD-SHELL", "curl -fsS http://127.0.0.1:3100/api/health || exit 1"], interval = 30, timeout = 5, retries = 3, startPeriod = 90 }
    logConfiguration = { logDriver = "awslogs", options = { awslogs-group = aws_cloudwatch_log_group.environment[each.key].name, awslogs-region = var.aws_region, awslogs-stream-prefix = "foundation" } }
    dependsOn        = each.value.ephemeral_db ? [{ containerName = "postgres", condition = "HEALTHY" }] : []
    }], each.value.ephemeral_db ? [{
    name      = "postgres"
    image     = "postgres:17-alpine"
    essential = true
    environment = [
      { name = "POSTGRES_DB", value = "foundation_dev" },
      { name = "POSTGRES_USER", value = "foundation_dev" },
      { name = "POSTGRES_PASSWORD", value = random_password.development_database.result }
    ]
    healthCheck      = { command = ["CMD-SHELL", "pg_isready -U foundation_dev -d foundation_dev"], interval = 10, timeout = 5, retries = 5, startPeriod = 15 }
    logConfiguration = { logDriver = "awslogs", options = { awslogs-group = aws_cloudwatch_log_group.environment[each.key].name, awslogs-region = var.aws_region, awslogs-stream-prefix = "postgres" } }
  }] : []))
}

resource "aws_ecs_service" "environment" {
  for_each        = local.environments
  name            = "foundation-${each.value.short}"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.environment[each.key].arn
  desired_count   = 0
  launch_type     = "FARGATE"
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  propagate_tags                     = "SERVICE"
  network_configuration {
    subnets          = aws_subnet.application[*].id
    security_groups  = [aws_security_group.application[each.key].id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.environment[each.key].arn
    container_name   = "foundation"
    container_port   = 3100
  }
  lifecycle { ignore_changes = [task_definition, desired_count] }
  depends_on = [aws_lb_listener_rule.environment, aws_efs_mount_target.this]
}
