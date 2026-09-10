resource "random_password" "database" {
  length  = 32
  special = false
}
resource "random_password" "development_database" {
  length  = 32
  special = false
}
resource "random_password" "auth" {
  for_each = local.environments
  length   = 64
  special  = false
}
resource "random_password" "master_key" {
  for_each = local.environments
  length   = 32
  special  = false
}

resource "random_id" "final_snapshot" { byte_length = 4 }

resource "aws_db_subnet_group" "this" {
  name       = "foundation-prod-data"
  subnet_ids = aws_subnet.data[*].id
}

resource "aws_db_instance" "production" {
  identifier                      = "foundation-prod-postgres"
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
  multi_az                        = false
  publicly_accessible             = false
  db_subnet_group_name            = aws_db_subnet_group.this.name
  vpc_security_group_ids          = [aws_security_group.database.id]
  backup_retention_period         = var.database_backup_retention_days
  auto_minor_version_upgrade      = true
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "foundation-prod-final-${random_id.final_snapshot.hex}"
  performance_insights_enabled    = false
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
}

resource "aws_secretsmanager_secret" "database_url" {
  for_each                = local.environments
  name                    = "foundation/${each.key}/database-url"
  recovery_window_in_days = each.key == "production" ? 30 : 7
}

resource "aws_secretsmanager_secret_version" "database_url" {
  for_each      = local.environments
  secret_id     = aws_secretsmanager_secret.database_url[each.key].id
  secret_string = each.key == "production" ? "postgresql://foundation:${random_password.database.result}@${aws_db_instance.production.address}:5432/foundation" : "postgresql://foundation_dev:${random_password.development_database.result}@127.0.0.1:5432/foundation_dev"
}

resource "aws_secretsmanager_secret" "auth" {
  for_each                = local.environments
  name                    = "foundation/${each.key}/better-auth-secret"
  recovery_window_in_days = each.key == "production" ? 30 : 7
}
resource "aws_secretsmanager_secret_version" "auth" {
  for_each      = local.environments
  secret_id     = aws_secretsmanager_secret.auth[each.key].id
  secret_string = random_password.auth[each.key].result
}

resource "aws_secretsmanager_secret" "master_key" {
  for_each                = local.environments
  name                    = "foundation/${each.key}/secrets-master-key"
  recovery_window_in_days = each.key == "production" ? 30 : 7
}
resource "aws_secretsmanager_secret_version" "master_key" {
  for_each      = local.environments
  secret_id     = aws_secretsmanager_secret.master_key[each.key].id
  secret_string = random_password.master_key[each.key].result
}

resource "aws_efs_file_system" "this" {
  encrypted       = true
  throughput_mode = "bursting"
  tags            = { Name = "foundation-data" }
  lifecycle_policy { transition_to_ia = "AFTER_30_DAYS" }
}

resource "aws_efs_mount_target" "this" {
  count           = 2
  file_system_id  = aws_efs_file_system.this.id
  subnet_id       = aws_subnet.data[count.index].id
  security_groups = [aws_security_group.filesystem.id]
}

resource "aws_efs_access_point" "environment" {
  for_each       = local.environments
  file_system_id = aws_efs_file_system.this.id
  posix_user {
    uid = 1000
    gid = 1000
  }
  root_directory {
    path = "/${each.value.short}"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "0750"
    }
  }
}
