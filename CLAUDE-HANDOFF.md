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

### BLOQUEO #1 (el que manda): Bedrock tiene cuota CERO en esta cuenta

Descubierto probando Claude Code contra Bedrock con credenciales reales. La
conexión funciona, la autenticación funciona, y la API responde:

```
api_error_status: 429
"Too many tokens per day, please wait before trying again."
```

La causa no es el permiso. Es la cuota de la cuenta, en `mx-central-1` **y** en
`us-east-1`:

```
Global cross-region model inference tokens per day      → 0
Global cross-region model inference tokens per minute    → 0
Global cross-region model inference requests per minute  → 0
Cross-region model inference tokens per minute           → 0
```

Cuenta nueva sin historial: AWS asigna cuota cero para inferencia on-demand
hasta que se solicita un aumento. Sólo las cuotas de *batch inference* son > 0.

**Esto bloquea Foundation Cloud por completo**, con o sin permisos, con o sin
despliegue. Ningún agente puede ejecutarse hasta que AWS apruebe cuota.

Comprobado también en `us-west-2`, donde la cuenta **sí** tiene 6.000.000
tokens/minuto para Sonnet 4.6 — pero la cuota **por día** sigue en 0, así que
tampoco pasa una sola invocación. El límite diario manda sobre el de minuto.

**Los códigos exactos (mx-central-1, Sonnet 4.6):**

| Código | Valor | ¿Ajustable? | Cuota |
|---|---|---|---|
| `L-7BEE40FB` | 0 | sí | tokens por minuto (global cross-region) |
| `L-F6E116D7` | 0 | sí | requests por minuto (global cross-region) |
| **`L-248E47B7`** | **0** | **NO** | **tokens por día (global cross-region)** |

**Esto es lo importante: la cuota que bloquea NO es ajustable por autoservicio.**
No hay formulario de Service Quotas que la suba. AWS la gestiona según el
historial de la cuenta, y una cuenta nueva sin facturación previa arranca en 0.

**Qué hacer:**
1. Abrir un caso en **AWS Support** (Account and billing → Service limit
   increase → Bedrock) pidiendo habilitar inferencia on-demand de Claude en la
   cuenta. Menciona que `L-248E47B7` está en 0 y no es ajustable.
2. En paralelo, pedir por Service Quotas las dos ajustables:

```bash
aws service-quotas request-service-quota-increase --region mx-central-1 \
  --service-code bedrock --quota-code L-7BEE40FB --desired-value 2000000
aws service-quotas request-service-quota-increase --region mx-central-1 \
  --service-code bedrock --quota-code L-F6E116D7 --desired-value 1000
```

Suele ayudar tener un método de pago verificado y algo de facturación en la
cuenta. **Es el camino crítico del lanzamiento**: sin esto no hay Foundation
Cloud, por mucho que el código y la infraestructura estén listos.

Nota: la invocación de AgentCore en us-east-1 sí llegó al modelo antes
(`model_call_count: 4`), probablemente consumiendo el margen inicial. Después de
eso, todo devuelve 429.

### BLOQUEO #2 — un solo comando, requiere al fundador

**S3 ya está resuelto**: los buckets llevan una *bucket policy* que concede
directamente a `foundation-dev-ecs-task` y `foundation-prod-ecs-task`. Dentro de
una misma cuenta una concesión basada en recurso es suficiente, así que los run
logs funcionan sin política de identidad. Verificado con
`simulate-principal-policy` contra la policy viva: `s3:PutObject → allowed`.

**Falta sólo Bedrock**, que no admite políticas basadas en recurso y exige una
política de identidad en el rol de la task. El usuario `foundation-cli` no puede
crearla (su IAM está limitado a `role/paperclip-agentcore-*`; verificado:
`implicitDeny` en `PutRolePolicy`, `CreateRole`, `CreatePolicy`,
`CreateServiceSpecificCredential`). El rol del pipeline tampoco tiene IAM.

**Ejecutar en CloudShell:**

```bash
cat > /tmp/bedrock.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "InvokeBedrockAnthropic",
    "Effect": "Allow",
    "Action": ["bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream",
               "bedrock:ListFoundationModels","bedrock:GetFoundationModel",
               "bedrock:ListInferenceProfiles","bedrock:GetInferenceProfile"],
    "Resource": "*"
  }]
}
JSON

for role in foundation-dev-ecs-task foundation-prod-ecs-task; do
  aws iam put-role-policy --role-name "$role" \
    --policy-name FoundationCloudBedrock \
    --policy-document file:///tmp/bedrock.json
done
```

Después:

```bash
bash scripts/verify-foundation-cloud.sh foundation dev
```

Para que yo pueda hacerlo sin ti la próxima vez, añade a
`FoundationAgentCoreProvisioning` un statement con
`iam:PutRolePolicy`/`GetRolePolicy`/`DeleteRolePolicy` sobre
`arn:aws:iam::523859314550:role/foundation-*-ecs-task`. No es admin: sigue sin
poder tocar ECS, RDS ni crear roles nuevos.

### Por qué la verificación final también te necesita a ti

Aunque apliques la política de Bedrock, yo no puedo cerrar el ciclo solo. Dos
barreras, ambas deliberadas y ambas tuyas:

1. **ECS:** `foundation-dev` queda en `desired-count 0` al final de cada deploy,
   y mi usuario tiene `explicitDeny` sobre `ecs:UpdateService`, `DescribeServices`
   y `RunTask` — el Deny que protege producción. No puedo levantar el servicio
   para ejecutar un agente.
2. **Cloudflare Access:** la UI de dev y prod está restringida a tu cuenta de
   Gmail. No puedo abrir la aplicación ni disparar un run desde la interfaz.

No son fallos: son las protecciones que pediste, funcionando. Pero implican que
el último tramo (ejecutar un agente y ver la fila en `cost_events`) lo haces tú,
o me amplías esos dos accesos a sabiendas de lo que significan.

### Pendiente después de desbloquear

1. Escalar `foundation-dev` a 1 (el deploy lo apaga al terminar) y ejecutar un agente.
2. Verificar `cost_events`: `cost_cents > 0` y `cost_status = reported` con `biller = aws_bedrock`.
3. Verificar objetos en `s3://paperclip-agentcore-foundation-runlogs-dev/run-logs/<companyId>/<agentId>/`.
4. Elegir y contratar proveedor de sandbox (ver RIESGO ABIERTO).
5. El onboarding sigue con Foundation Cloud **deshabilitado**; activarlo sólo cuando 2 y 3 estén verdes.

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


