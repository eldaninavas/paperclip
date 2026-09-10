variable "aws_region" {
  description = "AWS home Region for Foundation."
  type        = string
  default     = "mx-central-1"

  validation {
    condition     = var.aws_region == "mx-central-1"
    error_message = "Foundation is intentionally pinned to Mexico (mx-central-1)."
  }
}

variable "github_repository" {
  description = "GitHub repository allowed to request deployment credentials."
  type        = string
  default     = "eldaninavas/paperclip"
}
