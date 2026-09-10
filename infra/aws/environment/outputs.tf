output "vpc_id" { value = aws_vpc.this.id }
output "alb_dns_name" { value = aws_lb.this.dns_name }
output "alb_zone_id" { value = aws_lb.this.zone_id }
output "ecs_cluster_name" { value = aws_ecs_cluster.this.name }
output "ecs_service_names" { value = { for key, service in aws_ecs_service.environment : key => service.name } }
output "ecs_task_families" { value = { for key, task in aws_ecs_task_definition.environment : key => task.family } }
output "target_group_arns" { value = { for key, group in aws_lb_target_group.environment : key => group.arn } }
output "github_deploy_role_arns" { value = { for key, role in aws_iam_role.github_deploy : key => role.arn } }
output "domains" { value = { for key, environment in local.environments : key => environment.domain } }
