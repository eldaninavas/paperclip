# Foundation cloud environments

Foundation has three independent execution contexts:

| Environment | Address | Runtime | Data |
|---|---|---|---|
| Local | `http://127.0.0.1:3100` | Local process | Local PostgreSQL |
| Development | `https://dev.foundation.davaria.app` | Fargate, normally scaled to zero | Ephemeral PostgreSQL sidecar + isolated EFS path |
| Production | `https://foundation.davaria.app` | Fargate, one task | Private RDS PostgreSQL + isolated EFS path |

Development and production have separate ECS services, task definitions,
security groups, secrets, IAM roles, logs, filesystems paths, databases and
GitHub environments. They share an immutable ECR repository, ECS cluster, VPC
and ingress load balancer to stay within the pre-revenue budget.

## Network boundary

The shared Application Load Balancer uses
`dualstack-without-public-ipv4`. It is reachable from the Internet only over
IPv6 and its security group accepts HTTPS only from Cloudflare's published IPv6
origin ranges. Cloudflare Access is therefore the public identity boundary, but
Foundation does not depend on Cloudflare Tunnel.

The ALB routes by hostname to separate target groups. Fargate tasks accept port
3100 only from the ALB security group. RDS and EFS live in data subnets without
an Internet route; RDS accepts PostgreSQL only from the production service.
Tasks receive temporary public egress so images and provider endpoints remain
reachable without a fixed NAT Gateway charge. Those addresses are never used as
the application entry point.

## Identity boundary

Cloudflare Access initially allows only `daniel.navasp24@gmail.com` through
email one-time PIN authentication. Foundation retains its own authenticated
deployment mode for application sessions and audit records.

GitHub Actions authenticates to AWS with OIDC. No permanent AWS access key is
stored in GitHub. The development and production roles trust only their exact
GitHub environment in `eldaninavas/paperclip`.

## Deployment behavior

1. A push to `master` verifies the monorepo and creates an immutable ARM64 image.
2. Development scales from zero, deploys that image and must become healthy in
   its ALB target group.
3. Development scales back to zero even when validation fails.
4. A manual production run promotes the exact image that passed development.
5. The production GitHub environment requires Daniel's approval.
6. ECS deployment circuit breakers retain the previous task revision and roll
   back failed deployments automatically.

## Cost boundary

Only production runs continuously. Development compute and its PostgreSQL
sidecar exist only during validation. Production uses one Single-AZ
`db.t4g.micro`; the ALB has no billable public IPv4 addresses; container
insights and RDS Performance Insights are disabled. AWS Budgets must alert at
USD 35 and USD 45 against a USD 50 monthly operating ceiling.

## Bootstrap

1. Apply `infra/aws/bootstrap` once from an administrator session.
2. Request an ACM certificate for both Foundation hostnames and validate it in
   Cloudflare DNS.
3. Copy `foundation.tfvars.example` outside the repository, fill the bootstrap
   outputs and certificate ARN, then apply `infra/aws/environment` once.
4. Proxy both hostnames to the ALB hostname in Cloudflare.
5. Enable Cloudflare Access and allow only the authorized Gmail address.
6. Configure GitHub environment variables from Terraform outputs.
7. Run the deployment workflow and approve the production promotion.

Provider credentials are not committed. Future Bedrock or API credentials use
the task role or environment-scoped Secrets Manager entries.
