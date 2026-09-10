variable "aws_region" {
  type    = string
  default = "mx-central-1"
  validation {
    condition     = var.aws_region == "mx-central-1"
    error_message = "Foundation is intentionally pinned to Mexico (mx-central-1)."
  }
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}
variable "development_domain_name" {
  type    = string
  default = "dev.foundation.davaria.app"
}
variable "production_domain_name" {
  type    = string
  default = "foundation.davaria.app"
}
variable "github_repository" {
  type    = string
  default = "eldaninavas/paperclip"
}
variable "github_oidc_provider_arn" { type = string }
variable "ecr_repository_arn" { type = string }
variable "ecr_repository_url" { type = string }
variable "acm_certificate_arn" { type = string }
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
  default = 50
}
variable "database_backup_retention_days" {
  type    = number
  default = 7
}
variable "production_ecs_cpu" {
  type    = number
  default = 256
}
variable "production_ecs_memory" {
  type    = number
  default = 2048
}
variable "development_ecs_cpu" {
  type    = number
  default = 512
}
variable "development_ecs_memory" {
  type    = number
  default = 2048
}
variable "cloudflare_ipv6_cidrs" {
  type = list(string)
  default = [
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32",
    "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29",
    "2c0f:f248::/32",
  ]
}
variable "budget_email" {
  type    = string
  default = "daniel.navasp24@gmail.com"
}
