variable "aws_region" {
  type    = string
  default = "mx-central-1"

  validation {
    condition     = var.aws_region == "mx-central-1"
    error_message = "Foundation is intentionally pinned to Mexico (mx-central-1)."
  }
}

variable "environment" {
  type = string
  validation {
    condition     = contains(["development", "production"], var.environment)
    error_message = "environment must be development or production."
  }
}

variable "domain_name" { type = string }
variable "vpc_cidr" { type = string }
variable "github_repository" {
  type    = string
  default = "eldaninavas/paperclip"
}
variable "github_oidc_provider_arn" { type = string }
variable "ecr_repository_arn" { type = string }
variable "ecr_repository_url" { type = string }
variable "database_instance_class" {
  type    = string
  default = "db.t4g.micro"
}
variable "database_allocated_storage" {
  type    = number
  default = 20
}
variable "database_max_allocated_storage" {
  type    = number
  default = 100
}
variable "database_backup_retention_days" {
  type    = number
  default = 7
}
variable "database_deletion_protection" {
  type    = bool
  default = true
}
variable "database_multi_az" {
  type    = bool
  default = false
}
variable "ecs_cpu" {
  type    = number
  default = 2048
}
variable "ecs_memory" {
  type    = number
  default = 4096
}
variable "desired_count" {
  type    = number
  default = 0
}
variable "log_retention_days" {
  type    = number
  default = 30
}
