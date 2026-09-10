data "aws_availability_zones" "available" { state = "available" }

locals {
  azs   = slice(data.aws_availability_zones.available.names, 0, 2)
  image = "${var.ecr_repository_url}:bootstrap"
  environments = {
    development = { short = "dev", domain = var.development_domain_name, ephemeral_db = true }
    production  = { short = "prod", domain = var.production_domain_name, ephemeral_db = false }
  }
}
