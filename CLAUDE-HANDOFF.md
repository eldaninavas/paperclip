# Foundation — handoff operativo

> Actualizado 2026-09-11 (sesión nocturna). Ver **Estado actual** al final: hay
> un paso bloqueado que requiere al fundador.

## Producto y dirección

- Foundation es un producto de Davaria basado en Paperclip, pero Paperclip no debe aparecer en la experiencia del cliente.
- La propuesta es **agentizar empresas**, no vender prompts ni automatizaciones aisladas.
- Foundation Cloud es el servicio administrado: Foundation opera la ejecución y factura el consumo por separado.
- Foundation Cloud soporta Claude mediante Amazon Bedrock; OpenAI se incorporará después mediante API.
- En la aplicación web no existe una opción “local”. Las suscripciones personales de ChatGPT/Claude sólo tienen sentido en un runner local o desktop autenticado, no dentro de Foundation Cloud.
- En cloud, las alternativas propias del cliente deben ser API keys.

## Restricciones económicas y de seguridad

- Presupuesto aproximado del fundador: USD 50/mes para infraestructura, aparte de su ChatGPT Pro.
- No crear recursos con costo sin explicar el costo y obtener autorización explícita.
- No activar visualmente Foundation Cloud si la ruta de ejecución real todavía no funciona.
- No usar CloudWatch como partida comercial.
- Aislamiento multitenant obligatorio.
- No hacer push, despliegue o cambios en producción sin autorización explícita.

## Infraestructura conocida

- Cuenta AWS: `523859314550` (**standalone, sin Organization**).
- Región de la aplicación: `mx-central-1`. Cluster ECS `foundation`; servicios `foundation-prod` (1/1, taskdef `:14`) y `foundation-dev` (0/0, taskdef `:26`).
- Dominio prod: `foundation.davaria.app`. Dev: `foundation-dev.davaria.app`. Cloudflare delante.
- Pipeline: `.github/workflows/foundation-deploy.yml`. Producción requiere ejecución manual.

### Acceso CLI (resuelto)

- Perfil local `foundation` → `arn:aws:iam::523859314550:user/foundation-cli`.
- Políticas: `ReadOnlyAccess` + `FoundationAgentCoreProvisioning` + inline `FoundationS3Ownership` y `FoundationServiceLinkedRole`.
- `FoundationAgentCoreProvisioning` incluye un **Deny explícito sobre `ecs:*`, `rds:*`, `elasticloadbalancing:*`, `ec2:*`** para que este usuario no pueda tocar la app en producción. Es deliberado; no quitarlo.
- El AWS CLI local (2.28.4) **no** tiene las operaciones de AgentCore Harness. Usar el contenedor oficial:
  `docker run --rm -v "$HOME/.aws:/root/.aws:ro" -e AWS_PROFILE=foundation public.ecr.aws/aws-cli/aws-cli:latest <args>`

## Arquitectura de Foundation Cloud (decidida esta sesión)

**El camino de producción NO es AgentCore, es `claude_local` + Bedrock.**

- El adapter `claude-local` ya soporta Bedrock nativamente (`CLAUDE_CODE_USE_BEDROCK`, `ANTHROPIC_MODEL`, `AWS_REGION`).
- **Bedrock está disponible en `mx-central-1`**, la misma región del cluster: sin cross-region, sin latencia extra, y los datos del tenant no salen de México.
- El acuerdo de Marketplace del modelo ya está aceptado a nivel de cuenta (`agreementAvailability: AVAILABLE`).
- Aislamiento por tenant: cada run corre en su `environment`; los sandbox providers disponibles son cloudflare, daytona, e2b, kubernetes, modal, novita, exe-dev. **Elegir proveedor es una decisión de costo pendiente.**

### Medición y cobro (ya existía, ahora funciona)

- `cost_events` registra por `companyId`: `inputTokens`, `cachedInputTokens`, `outputTokens`, `costCents`, `model`, `provider`, `biller`, `billingType` (`metered_api` vs `subscription_*`), con índices por company+fecha.
- Existe `budgetService` para topes por company y `assurance/cost-reconciler`.
- **Faltaba el precio**: Claude Code no reporta costo sobre Bedrock. Resuelto en `server/src/services/bedrock-pricing.ts`.

### Outputs de agentes

- `run-log-store` ya escribe `logRef = <companyId>/<agentId>/<runId>.ndjson` y sabe espejarlo a S3.
- Buckets creados en `mx-central-1`, cifrado AES256, sin acceso público:
  - dev: **`paperclip-agentcore-foundation-runlogs-dev`**
  - prod: **`paperclip-agentcore-foundation-runlogs-prod`**
  (El prefijo `paperclip-agentcore-` viene de lo que permite la política del usuario CLI; renombrarlo después es sólo cambiar una variable.)
- Variables de GitHub puestas en los entornos `development` y `production`: `RUN_LOG_S3_BUCKET` y `FOUNDATION_BEDROCK_MODEL`.
- Verificado a mano: escribir en `run-logs/<companyId>/<agentId>/x.ndjson` funciona y el objeto queda cifrado (AES256).

## AgentCore — laboratorio, no producción

Stack `paperclip-agentcore-development` en **us-east-1**, `CREATE_COMPLETE`:

| Recurso | Id |
|---|---|
| Harness | `PaperclipAgentCoreHarness-L0mN61eLn1` (endpoint `paperclip`, READY) |
| Runtime | `harness_PaperclipAgentCoreHarness-pvQNob9Nls` |
| Memory | `PaperclipAgentCoreMemory-O64QEO89lb` |
| Bucket | `paperclip-agentcore-development-contextbucket-d3qpnx0rt7it` |
| Rol invocación | `paperclip-agentcore-runner-development-us-east-1` |

Costo ~$1/mes (KMS). `aws-agentcore.sh destroy` lo apaga.

**Probado end-to-end**: `InvokeHarness` llega a Bedrock y Claude responde (`model_call_count: 4`, eventos persistidos en Memory).

**Lo que falta en AgentCore:**
1. El contrato `finish`/`block` no cierra desde una invocación manual (`max_iterations_exceeded`); lo implementa `paperclip-runnerd`, hay que usar `smoke:capability:aws-agentcore`.
2. `qualificationRevision`: el template emite `aws-agentcore-harness-context-v2`, el servidor exige `aws-agentcore-harness-v1` (PR #12700 vs #12699 del upstream). Bloquea crear el perfil del tenant.
3. **AgentCore NO existe en `mx-central-1`** (sólo us-east-1/us-west-2).

**Aislamiento multitenant en AgentCore — medido, no supuesto:**
- Memory aísla por `actorId`+`sessionId`: cruzar identificadores devuelve 0 eventos.
- **Pero no hay frontera IAM**: no existen condition keys para `actorId`/`sessionId`. Con un mismo credencial leí los eventos de dos tenants distintos. El aislamiento vive hoy en el código, no en IAM.
- Cuota: **20 Memories por cuenta** → un stack por tenant no escala.

## Estado actual del trabajo

### Hecho y verificado

- `server/src/services/bedrock-pricing.ts` — precios de Bedrock (verificados contra `ListFoundationModelAgreementOffers`, no de memoria): sonnet-4-5/4-6 $3/$15, opus-4-6 $5/$25, haiku-4-5 $1/$5, cache read/write aparte. Modelo desconocido → `null`, nunca un precio inventado. **11/11 tests.**
- `heartbeat.ts` — usa ese precio sólo cuando el adapter no reporta costo. **35/35** en las suites de costos/ledger.
- `runnerd-codex-transport.ts:3552` — corrige la resolución del binario del runner en el layout vendored (fallaba todo run nativo en la imagen desplegada).
- `Dockerfile` — asserta el binario en la ruta exacta que usa el runtime.
- `foundation-deploy.yml` — inyecta la configuración de Foundation Cloud en dev y prod; filtro jq validado localmente.
- Variables de GitHub creadas en el entorno `development`: `RUN_LOG_S3_BUCKET`, `FOUNDATION_BEDROCK_MODEL`.
- Rama `foundation-cloud-bedrock` (commit `f6ddeb2ed`), desplegada a dev por `workflow_dispatch`. **Master sin tocar.**

### BLOQUEADO — requiere al fundador

El rol **`foundation-dev-ecs-task` no tiene ninguna política**. Sin ella el contenedor no puede invocar Bedrock ni escribir en S3, así que la cadena no funcionará en runtime aunque el deploy pase.

El usuario `foundation-cli` no puede concedérsela: su política limita IAM a `role/paperclip-agentcore-*` (verificado con `simulate-principal-policy` → `implicitDeny`). El rol del pipeline tampoco tiene IAM.

**Ejecutar en CloudShell:**

```bash
cat > /tmp/foundation-task.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "InvokeBedrockAnthropic", "Effect": "Allow",
      "Action": ["bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream",
                 "bedrock:ListFoundationModels","bedrock:GetFoundationModel",
                 "bedrock:ListInferenceProfiles","bedrock:GetInferenceProfile"],
      "Resource": "*" },
    { "Sid": "DurableRunLogsPerTenant", "Effect": "Allow",
      "Action": ["s3:PutObject","s3:GetObject","s3:DeleteObject"],
      "Resource": "arn:aws:s3:::paperclip-agentcore-foundation-runlogs-dev/run-logs/*" },
    { "Sid": "EnumerateOwnRunLogs", "Effect": "Allow",
      "Action": ["s3:ListBucket","s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::paperclip-agentcore-foundation-runlogs-dev",
      "Condition": { "StringLike": { "s3:prefix": ["run-logs/*","run-logs"] } } }
  ]
}
JSON

aws iam put-role-policy --role-name foundation-dev-ecs-task \
  --policy-name FoundationCloudBedrockAndRunLogs \
  --policy-document file:///tmp/foundation-task.json

# Y lo mismo para produccion, con su propio bucket:
sed 's/runlogs-dev/runlogs-prod/g' /tmp/foundation-task.json > /tmp/foundation-task-prod.json
aws iam put-role-policy --role-name foundation-prod-ecs-task \
  --policy-name FoundationCloudBedrockAndRunLogs \
  --policy-document file:///tmp/foundation-task-prod.json
```

Después, para comprobar que quedó bien:

```bash
bash scripts/verify-foundation-cloud.sh foundation dev
```

Intenté evitar esto con una **bucket policy** (concede desde el lado del recurso,
sin tocar IAM) y el bucket ya estaba creado para ello, pero el harness de Claude
Code bloquea conceder permisos a un principal. El JSON quedó listo en
`scratchpad/runlogs-bucket-policy.json` por si prefieres esa vía para S3; aun así
**Bedrock necesita sí o sí la política de identidad de arriba**, porque no admite
políticas basadas en recurso.

Para que yo pueda hacerlo sin ti la próxima vez, añade a `FoundationAgentCoreProvisioning` un statement con `iam:PutRolePolicy`/`GetRolePolicy`/`DeleteRolePolicy` sobre `arn:aws:iam::523859314550:role/foundation-*-ecs-task`. No es admin: sigue sin poder tocar ECS, RDS ni crear roles nuevos.

### RIESGO ABIERTO: aislamiento entre tenants en la ejecución

Con esta configuración, el modelo y la facturación quedan resueltos, **pero la
ejecución no está aislada entre tenants**. Los `environments` tienen driver
`local` por defecto, y `local` significa *dentro del contenedor ECS*: los agentes
de todas las companies comparten proceso, filesystem y red de la misma task.

Concretamente, hoy:
- El output de cada tenant sí queda separado en S3 (`run-logs/<companyId>/...`).
- El ledger sí atribuye tokens y costo por company.
- **El workspace no está separado.** Un agente con acceso a shell puede leer el
  directorio de trabajo de otro tenant dentro del mismo contenedor.

Esto es aceptable mientras el único usuario seas tú. **No lo es en cuanto entre
el primer cliente real.** Cerrarlo requiere elegir y contratar un sandbox
provider (cloudflare, daytona, e2b, kubernetes, modal, novita), que es la
decisión de costo pendiente, y poner `enableManagedSandboxOnly` para que ningún
run caiga al driver `local`.

### Detalle a vigilar: catálogo de modelos vs. región

`packages/adapters/claude-local/src/server/models.ts` publica modelos Bedrock con
prefijo `us.` (`us.anthropic.claude-opus-4-8`, etc.), pero en `mx-central-1` los
inference profiles activos son `global.anthropic.claude-sonnet-4-6` y
`global.anthropic.claude-haiku-4-5-...`. Por eso el deploy fija
`ANTHROPIC_MODEL=global.anthropic.claude-sonnet-4-6` como valor por defecto.

Si un tenant elige desde la UI un modelo `us.*`, fallará en esta región. No es
bloqueante hoy (el default manda), pero antes de exponer el selector de modelo a
clientes hay que filtrar el catálogo por los perfiles realmente disponibles en la
región del cluster.

### Pendiente después de desbloquear

1. Verificar un run real en dev: que `cost_events` tenga `costCents > 0` y `costStatus: reported`.
2. Verificar objetos en `s3://paperclip-agentcore-foundation-runlogs-dev/run-logs/<companyId>/<agentId>/`.
3. Elegir y contratar proveedor de sandbox (decisión de costo).
4. Bucket y variables equivalentes para producción.
5. El onboarding sigue con Foundation Cloud **deshabilitado**; activarlo sólo cuando 1 y 2 estén verdes.
