data "aws_caller_identity" "current" {}

data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_kms_key" "terraform" {
  description             = "Foundation Terraform state"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "terraform" {
  name          = "alias/foundation-terraform-state"
  target_key_id = aws_kms_key.terraform.key_id
}

resource "aws_s3_bucket" "terraform" {
  bucket = "foundation-terraform-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "terraform" {
  bucket = aws_s3_bucket.terraform.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform" {
  bucket = aws_s3_bucket.terraform.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.terraform.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "terraform" {
  bucket                  = aws_s3_bucket.terraform.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "terraform_locks" {
  name         = "foundation-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

resource "aws_ecr_repository" "foundation" {
  name                 = "foundation/server"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "foundation" {
  repository = aws_ecr_repository.foundation.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the latest 30 immutable builds"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 30
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

output "terraform_state_bucket" { value = aws_s3_bucket.terraform.id }
output "terraform_state_kms_key_arn" { value = aws_kms_key.terraform.arn }
output "terraform_lock_table" { value = aws_dynamodb_table.terraform_locks.name }
output "ecr_repository_url" { value = aws_ecr_repository.foundation.repository_url }
output "github_oidc_provider_arn" { value = aws_iam_openid_connect_provider.github.arn }
output "aws_account_id" { value = data.aws_caller_identity.current.account_id }
