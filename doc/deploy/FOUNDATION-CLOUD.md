# Foundation cloud environments

Foundation has three deliberately separate execution contexts:

| Environment | Address | Data | Entry point |
|---|---|---|---|
| Local | `http://127.0.0.1:3100` | Embedded/local PostgreSQL | Loopback only |
| Development | `https://dev.foundation.davaria.app` | Dedicated RDS + EFS | Cloudflare Access + Tunnel |
| Production | `https://foundation.davaria.app` | Dedicated RDS + EFS | Cloudflare Access + Tunnel |

Development and production do not share a VPC, database, filesystem, secrets,
ECS cluster, service, task roles, logs, or Cloudflare tunnel. They share only an
immutable ECR image repository. Application data never enters that repository.

## Network boundary

Each AWS environment is deployed in `mx-central-1` and spans two availability
zones. ECS receives an ephemeral egress address, but its security group has no
inbound rules at all. RDS and EFS run in data subnets with no internet route.
Cloudflare Tunnel originates the connection from the ECS task, so there is no
public load balancer, open application port, or reachable origin that bypasses
Cloudflare Access.

This design intentionally avoids a fixed NAT Gateway charge in each environment
while the product is pre-revenue. Moving ECS behind NAT later does not improve
the current ingress boundary—the security group already rejects every inbound
connection—but it can be enabled when a fixed outbound IP or a stricter network
compliance profile justifies the cost.

## Identity boundary

Cloudflare Access is the outer identity gate. Initially, both applications use
email one-time PIN authentication and allow only `daniel.navasp24@gmail.com`.
Foundation still runs in `authenticated/public` mode behind that gate; Cloudflare
Access is not used as a replacement for Foundation's own session and audit model.

GitHub Actions uses AWS OIDC. There are no permanent AWS access keys in GitHub.
The trust policy is bound to `eldaninavas/paperclip` and to the exact GitHub
environment name. Development cannot assume the production role.

## Deployment behavior

- Every push to `master` verifies, builds and deploys development.
- Production is a manual promotion of the exact image already deployed to dev.
- The GitHub `production` environment must require Daniel as reviewer.
- ECS deployment circuit breakers automatically roll back a failed rollout.
- ECR tags are immutable and old task-definition revisions remain available for
  an explicit rollback.

## Bootstrap sequence

1. Apply `infra/aws/bootstrap` once from an authenticated administrator session.
2. Create the Cloudflare tunnels and Access policies for both hostnames.
3. Apply `infra/aws/environment` once for development and once for production.
4. Put each tunnel token in its matching AWS Secrets Manager secret.
5. Configure the GitHub environment variables from Terraform outputs.
6. Run `Foundation deploy`; validate development; approve the production gate.

Do not place model-provider keys in the infrastructure repository. Bedrock or
other runtime credentials belong to the ECS task role or environment-scoped
Secrets Manager entries when that runtime is intentionally enabled.

## Local

The local environment remains unchanged:

```sh
pnpm install
pnpm dev
```

Local state and authentication are never promoted into development or production.
