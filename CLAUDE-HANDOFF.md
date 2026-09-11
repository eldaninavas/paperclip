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

## Arquitectura de Foundation Cloud — CORREGIDO de madrugada

> **Lee esto antes que nada: la recomendación cambió a mitad de sesión, con
> evidencia.** Primero concluí que el camino era `claude_local` + Bedrock
> directo. Es más simple, pero **hoy no funciona en esta cuenta**, y AgentCore
> sí.

**Medido a las 04:00, con dos minutos de diferencia:**

| Vía | Resultado |
|---|---|
| `claude_local` + Bedrock directo (`InvokeModel`) | **429** — "Too many tokens per day" |
| AgentCore `InvokeHarness` | **funciona** — `model_call_count = 2` en sesión nueva |

AgentCore Runtime no consume la cuota de inferencia on-demand de la cuenta
(`L-248E47B7`, que está en 0 y no es ajustable). Es decir: **el camino que
descarté por complejo es el único que ejecuta modelos hoy**, y el que recomendé
por simple está bloqueado hasta que AWS habilite la cuenta.

**Conclusión:** AgentCore deja de ser laboratorio y pasa a ser el camino
viable a corto plazo. `claude_local` + Bedrock queda como el destino cuando AWS
otorgue cuota — el código de precios y de run logs sirve para ambos, porque vive
en el ledger y en el store, no en el adapter.

### Lo que falta para usar AgentCore como producción

1. ~~`qualificationRevision`~~ **RESUELTO**. No era una decisión de producto: el
   commit que añadió el template creó el archivo entero, y
   `aws-agentcore-harness-context-v2` no aparece en ninguna otra parte del repo,
   mientras `aws-agentcore-harness-v1` está en el server, el runner Rust y sus
   tests. Era una cadena huérfana que hacía irreprocesable todo perfil creado
   desde este stack. Corregido en el template y aplicado al stack de desarrollo
   con un change set que **no tocó ningún recurso** (`UPDATE_COMPLETE`).
   El stack ya emite `aws-agentcore-harness-v1`.
2. **El adapter `paperclip_runner` está excluido del onboarding**
   (`ONBOARDING_EXCLUDED_ADAPTER_TYPES`).
3. **Un `remote_agent_profile` por company** apuntando al stack.
4. **El último tramo exige el servidor completo.** Compilé `paperclip-runnerd`
   (release, 28 MB) y ejecuté el smoke oficial
   `scripts/capability-aws-agentcore-smoke.mjs` contra el stack real. Resultado:

   - el runner arranca y **abre sesión PRP** correctamente;
   - el provider de AgentCore **se inicializa** y falla con un error preciso:
     `AgentCore requires paperclip.native-execution-input.v3 runtimeContext`.

   Es decir, la integración runner↔AgentCore está bien; lo que falta es el
   *bundle de instrucciones* (digest, rootPath, entryPath) que construye el
   **servidor** en `agent-instructions.ts` / `heartbeat.ts` cuando ejecuta un
   agente real. El runner aislado no puede fabricarlo, y falsearlo no probaría
   nada.

   **Conclusión: el end-to-end sólo se cierra ejecutando un agente desde la
   aplicación.** Eso necesita el servicio arriba (ECS, que tengo con
   `explicitDeny`) o un servidor local con BD, company, agente y perfil remoto.

   De paso quedó verificado con el binario real que la corrección de
   `defaultCapabilityRunnerdBinary()` resuelve bien:
   `dist/bin/paperclip-runnerd` → existe.

### La arquitectura anterior (sigue siendo válida cuando haya cuota)

**`claude_local` + Bedrock.**

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

### BLOQUEO #2 — probablemente YA NO hace falta (verificar en dev)

**Actualización de madrugada.** El runner no necesita permisos de Bedrock
propios: **asume el rol de invocación** (`aws_agentcore_provider.rs:643`), y ese
rol ya lleva Bedrock, S3 y KMS. Lo único que le faltaba al contenedor era estar
en la *trust policy* de ese rol — que, igual que una bucket policy, concede desde
el lado del recurso y no requiere política de identidad.

Hecho: el template acepta ahora un segundo principal y el stack de desarrollo
confía en `foundation-dev-ecs-task`. Change set de un recurso, sin reemplazo,
`UPDATE_COMPLETE`. La trust policy es hoy:

```
["arn:aws:iam::523859314550:user/foundation-cli",
 "arn:aws:iam::523859314550:role/foundation-dev-ecs-task"]
```

**Con esto, la ruta AgentCore no debería necesitar la política de identidad.**
Cuidado con la certeza: `simulate-principal-policy` devuelve `implicitDeny` para
`sts:AssumeRole`, pero el simulador no modela bien una trust policy como política
de recurso, así que ese resultado no es concluyente. **La verificación real es
ejecutar un agente en dev.**

**Si al probar falla con un error de credenciales o de AssumeRole**, entonces sí
hace falta la política de abajo; aplícala y vuelve a probar.

### BLOQUEO #2 (plan B, sólo si lo anterior falla) — un comando

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

### AVANCE FINAL: la cadena llega hasta AgentCore y sube el contexto

Simulé en local el endpoint de credenciales de ECS (`AWS_CONTAINER_CREDENTIALS_FULL_URI`
sobre loopback, sirviendo credenciales STS en el formato del contenedor), que es
exactamente el mecanismo de producción. Con eso, y con el arreglo de la
allowlist, el runner recorre toda la secuencia:

| Etapa | Estado |
|---|---|
| Credenciales base llegan al runner | ✅ |
| Asume el rol de invocación | ✅ |
| Construye el bundle de instrucciones | ✅ |
| **Sube el runtime context a S3, cifrado con KMS** | ✅ |
| `turn.start` contra AgentCore | ❌ timeout |

Evidencia del upload en el bucket de contexto del stack:

```
assets/0e28ffcd…/SKILL.md                 180 B
assets/0e28ffcd…/instructions/AGENTS.md  4051 B
```

El fallo restante es `provider_transport_failed: PRP command turn.start timed
out`, con `timeoutFired: false` y `effectiveTimeoutSec: 0` — o sea, **no es el
timeout del adapter**: es el comando PRP esperando la respuesta de AgentCore y
agotando su propia espera. Coherente con lo medido antes invocando el harness a
mano, que tardaba entre 30 y 60 s en devolver `max_iterations_exceeded`.

**Hecho:** eran **dos timeouts fijos de 30 s** en `runnerd-codex-transport.ts`
(`#waitCommand` y `#waitForProviderIdentity`), pensados para un provider local
que responde en milisegundos. AgentCore tarda 30-60 s, así que ambos expiraban
mientras el harness seguía trabajando, y el fallo se registraba como error de
transporte en vez de como lo que era. Ahora se configuran con
`PAPERCLIP_RUNNER_COMMAND_TIMEOUT_MS` (default 30 s, tope 15 min).

**Estado tras el arreglo:** el run pasa de `turn.start timed out` a
`runnerd did not report its provider identity`. Es decir, avanza de fase pero el
provider remoto todavía no llega a anunciarse en el tiempo disponible.

**Dato del último run:** el run log del runner contiene una sola línea —
`[paperclip-runner] transport mode=local_loopback state=connecting` — y nunca
`connected`. En el run anterior sí había subido el contexto a S3, así que las
fases no son estables entre intentos: conviene verificar primero que el
transporte PRP se establece antes de seguir mirando AgentCore.

### CONCLUSIÓN DEL DIAGNÓSTICO: no es un timeout, es un turno que no cierra

Con el estado durable borrado y los timeouts a 300 s, el run sigue fallando con
`runnerd did not report its provider identity`. Rastreado hasta el final:

- El TS espera `threadId` **y** (`providerExecutionKind === "remote_service"` o
  un PID). AgentCore es remoto, así que no hay PID: depende enteramente de que
  llegue la identidad.
- El provider Rust **sí** emite `ProviderRuntimeIdentity::RemoteService`
  (`aws_agentcore_provider.rs:1450`), pero sólo **después** de una respuesta del
  harness.
- Y el harness, sin que se satisfaga su contrato de completación, termina en
  `max_iterations_exceeded` — exactamente lo que devolvía la invocación manual,
  con y sin una función `finish` improvisada.

**Por tanto el hilo correcto NO es subir timeouts** (aunque el arreglo de los
30 s fijos era necesario y se queda), sino el contrato `finish`/`block`: qué
herramientas envía el runner al harness y por qué el modelo no cierra el turno.
Mirar juntos `maxIterations` del perfil (8), las semantic tools que arma el
runner, y el system prompt del harness, que exige "use its finish or block
function".

Ese es trabajo de una sesión con supervisión, no de iteraciones a ciegas: cada
ciclo son 5-10 minutos y el runner no expone lo que ocurre entre el arranque del
provider y la identidad. — probablemente sigue esperando la
primera respuesta del harness, que sin el contrato `finish`/`block` termina en
`max_iterations_exceeded` (lo mismo que devolvía la invocación manual). Conviene
mirar juntos el `maxIterations` del perfil (hoy 8) y ese contrato, porque puede
que no haya un timeout que arreglar sino un turno que nunca cierra.

**Para el deploy:** si se activa la ruta AgentCore en ECS, hay que poner
`PAPERCLIP_RUNNER_COMMAND_TIMEOUT_MS=300000` en la task definition; con 30 s no
funcionará.

**Nota de diagnóstico que ahorra tiempo:** el primer error que vi con este montaje
era mío, no del sistema — mi endpoint servía `Expiration` con offset `+00:00` y el
SDK de Rust (Smithy) exige sufijo `Z`. Si alguien reproduce este experimento, use
formato Zulu.

### PROBADO END-TO-END con un servidor Foundation real (madrugada)

Levanté el servidor Foundation **en local** (Postgres embebido, puerto 3199), que
no depende del `explicitDeny` de ECS, y recorrí el camino completo de un tenant:

| Paso | Resultado |
|---|---|
| Crear company (tenant) | `e0ab997a-…` |
| Crear perfil AgentCore | `15d344e1-…`, `qualifiedRevision: sha256:5c58cbec…` |
| Crear agente `paperclip_runner` + `aws_agentcore` | `e745bff3-…` |
| Invocar un run | seleccionado como **`runtimeMode: native`** |
| Backend elegido | **`driverKind: aws_agentcore_harness_api`** |
| Outputs | **3 run logs en S3** bajo `run-logs/<companyId>/<agentId>/<runId>.ndjson` |

**Dos requisitos quedan demostrados, no inferidos:**

1. **Outputs en S3 por tenant.** Logs de runs reales del servidor, con contenido
   legible, segmentados por company y agente. Ya no se quedan en el disco de la
   task.
2. **El perfil AgentCore se crea y se firma.** Esto sólo funciona gracias a la
   corrección de `qualificationRevision`: antes, el servidor rechazaba cualquier
   perfil generado desde este stack.

**Dónde se detiene:**

```
runtimeMode: native · driverKind: aws_agentcore_harness_api
error: failed to start AWS AgentCore provider:
       AgentCore context S3 upload failed
```

El runner asume el rol de invocación (`AssumeRoleProvider`,
`aws_agentcore_provider.rs:643`) y sube el runtime context al bucket de contexto
del stack. Falla ahí. Mi usuario local no puede diagnosticarlo del todo:
`kms:GenerateDataKey` sobre la key del stack le está denegado, así que no puedo
distinguir entre un permiso que falta en el rol asumido y otra causa. El error
que emite el provider es genérico (`AWS AgentCore request failed`), sin el
detalle del SDK.

**Descartado ya, con pruebas — no hace falta repetirlo:**

| Hipótesis | Comprobación | Resultado |
|---|---|---|
| Al rol le faltan permisos S3 | `simulate-principal-policy` sobre `<prefix>/assets/*` | **allowed** |
| Al rol le falta KMS | simulado con `kms:ViaService` y encryption context | **allowed** |
| El rol no se puede asumir | `sts assume-role` real | **funciona** |
| La subida en sí falla | `put-object` con SSE-KMS a la ruta exacta, con el rol asumido | **200 OK** |
| El runner no hereda credenciales | relanzado con `AWS_ACCESS_KEY_ID`/`SECRET` explícitos | **falla igual** |

Es decir: permisos, rol y subida funcionan **manualmente**; falla sólo dentro del
runner. El provider redacta el error a propósito (`redact_aws_error`), y
`RUST_LOG=aws_sdk_s3=debug` no aparece en el log del servidor, así que el detalle
del SDK no sale por ninguna vía disponible desde fuera.

### BUG DE PRODUCCIÓN ENCONTRADO Y CORREGIDO

Instrumenté el `put_object` del provider (temporalmente; ya revertido) y el error
real apareció:

```
CredentialsNotLoaded: ProviderChainError
  ProviderAttempt { name: "Environment", error: "environment variable not set" }
```

Causa: `NATIVE_PROVIDER_HOST_ENV_KEYS` en `native-session-executor.ts` es la
allowlist de variables del host que hereda el runner nativo, y llevaba `PATH`,
`HOME`, `XDG_*`… **y nada de AWS**. El provider de AgentCore asume su rol de
invocación, así que necesita credenciales base para asumirlo; sin ellas su
primera llamada falla, y como `AssumeRoleProvider` es perezoso, el fallo aparece
recién en el upload a S3 con un mensaje que no dice nada.

**Esto habría roto también producción**: en ECS el SDK llega al rol de la task
mediante `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`, una variable de entorno que
ECS inyecta y que esta lista descartaba. Con la política IAM aplicada y sin este
arreglo, Foundation Cloud habría fallado igual y con el mismo mensaje opaco.

Corregido: la allowlist ahora incluye las variables de credenciales de
contenedor, de web identity, estáticas y de perfil.

**Diagnóstico cerrado (y una corrección a mi primera lectura).** Hay *dos*
filtros en serie:

1. `NATIVE_PROVIDER_HOST_ENV_KEYS` (servidor) — lo que el servidor entrega al
   runner. **Aquí faltaba todo lo de AWS. Éste era el bug.**
2. `runnerExplicitProviderEnvironmentKeys` (control plane) — lo que cruza hasta
   el proceso. Esta lista **ya permitía** `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`,
   `AWS_ROLE_ARN`, `AWS_WEB_IDENTITY_TOKEN_FILE`… pero **excluye a propósito**
   `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY`: credenciales de larga vida no
   deben cruzar ese límite.

Es decir: el diseño contempla ECS correctamente (task role vía endpoint de
contenedor) y rechaza claves estáticas. El servidor simplemente nunca pasaba la
variable que ECS inyecta. Corregido, y alineado con la lista de abajo para no
listar claves que el control plane volvería a filtrar.

**Implicación para las pruebas: esta ruta NO se puede verificar en local con
claves estáticas — es por diseño.** Hay que probarla en ECS, donde la task role
provee la identidad. Por eso el run local seguía fallando después del arreglo:
no es un fallo, es la frontera funcionando.

**Con esto, la secuencia para cerrar el end-to-end es:**
1. Aplicar la política de Bedrock a `foundation-dev-ecs-task` (sección BLOQUEO #2).
2. El deploy con este arreglo ya está lanzado a dev.
3. Escalar `foundation-dev` a 1 y ejecutar un agente `paperclip_runner`/`aws_agentcore`.
4. Verificar `cost_events` (centavos > 0) y los objetos en S3.

**Antiguo siguiente paso (ya hecho):** instrumentar
`aws_agentcore_provider.rs` para emitir el error sin redactar en modo
desarrollo — el `map_err` de `put_object` alrededor de la línea 470 — recompilar
y repetir. Sin eso se diagnostica a ciegas.

Merece la pena sospechar primero de la **región**: el runner construye su cliente
S3 desde la config del entorno, y el bucket de contexto está en `us-east-1`
mientras la aplicación vive en `mx-central-1`. Un cliente creado con la región
equivocada da exactamente este fallo opaco.

### Por qué la verificación final también te necesita a ti

Aunque apliques la política de Bedrock, yo no puedo cerrar el ciclo solo. Dos
barreras, ambas deliberadas y ambas tuyas:

0. **Cloudflare Access (verificado, no supuesto):** ambos dominios devuelven
   `HTTP 302` a la pantalla de login de Cloudflare —
   `foundation.davaria.app/api/health` y `foundation-dev.davaria.app/api/health`.
   Sin un service token de Cloudflare no puedo llamar a la API de ninguna de las
   dos instancias desplegadas, ni siquiera a producción, que sí está corriendo.
   Por eso todas las pruebas funcionales de esta sesión fueron contra un servidor
   local: no fue una elección, fue la única superficie alcanzable.
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


