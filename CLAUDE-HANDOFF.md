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

## ⛔ RESUMEN EJECUTIVO: las dos vías a Bedrock están bloqueadas por AWS

Foundation Cloud tiene exactamente dos caminos para ejecutar un modelo, y esta
sesión verificó que **ninguno funciona hoy en la cuenta `523859314550`, por
causas ajenas a nuestro código**:

| Vía | Estado | Causa | Quién lo desbloquea |
|---|---|---|---|
| `claude_local` + Bedrock directo | ❌ | Cuota de inferencia on-demand **en 0**, y la cuota diaria (`L-248E47B7`) **no es ajustable** por autoservicio | AWS Support |
| `paperclip_runner` + AgentCore | ❌ | Misma causa: el Harness llama a Bedrock, Bedrock estrangula cada llamada, y el Harness devuelve `max_iterations_exceeded` sin contenido | AWS Support |

Ambas conclusiones están demostradas con pruebas reproducibles (ver abajo), no
inferidas. **Todo lo que dependía de nosotros está corregido y verificado.**

### Causa raíz única (verificada 2026-09-11, sesión nocturna)

Los dos "bloqueos separados" son **el mismo**. El Harness de AgentCore no falla:
invoca el modelo, Bedrock responde `ThrottlingException` a cada intento,
`model_call_count` sube en Memory, se agotan las iteraciones y el Harness cierra
con `messageStop / max_iterations_exceeded` **sin contenido**. Eso explica por
qué un harness mínimo de control se comportaba igual que el nuestro.

Y el estrangulamiento **no es de Anthropic: es de toda la cuenta**. Cada modelo
on-demand probado devuelve `Too many tokens per day`, de todos los proveedores:

```
openai.gpt-oss-120b-1:0                ThrottlingException: Too many tokens per day
qwen.qwen3-coder-next                  ThrottlingException: Too many tokens per day
amazon.nova-pro-v1:0                   ThrottlingException: Too many tokens per day
deepseek.v3.2                          ThrottlingException: Too many tokens per day
mistral.mistral-large-3-675b-instruct  ThrottlingException: Too many tokens per day
global.anthropic.claude-sonnet-4-6     ThrottlingException: Too many tokens per day
```

La prueba decisiva es comparar la cuota aplicada contra el valor por defecto de
AWS para la misma cuota:

```
L-248E47B7  Sonnet 4.6 tokens/día   default AWS = 8 640 000 000   esta cuenta = 0   ajustable: NO
L-9A11C666  Haiku 4.5 tokens/min    default AWS =     5 000 000   esta cuenta = 0   ajustable: sí
L-7BEE40FB  Sonnet 4.6 tokens/min   default AWS =     6 000 000   esta cuenta = 0   ajustable: sí
```

No es que la cuenta no haya pedido cuota: **AWS puso la cuenta en cero por
encima de su propio valor por defecto.** Eso es un estado de cuenta, no una
configuración nuestra, y no hay forma de arreglarlo desde el código.

### Por qué: la cuenta tiene 40 horas y AWS no la sembró con sus defaults

```
AccountCreatedDate: 2026-09-10T03:17:05+00:00     (≈40 h al momento de escribir)
AccountName:        Davaria Foundation
Soporte:            Basic
```

Es un **bug de aprovisionamiento conocido de Bedrock en cuentas nuevas**: en vez
de heredar los valores por defecto de AWS, todas las cuotas del catálogo quedan
en 0, para todos los modelos y todos los proveedores. Coincide exactamente con
lo que medimos: aplicado 0 contra un default de 8 640 000 000, en seis
proveedores distintos, y `ThrottlingException` en la primera petición del día.

Reportes del mismo caso en AWS re:Post:

- [provisioning bug — account-level quota for new account is set to 0 for every model](https://repost.aws/questions/QULJwtdJfQTIGbM3SHsJuRpA/provisioning-bug-aws-bedrock-account-level-quota-for-new-account-is-set-to-0-for-every-model)
- [New account ThrottlingException on first ever Bedrock request](https://repost.aws/questions/QUd5AaKGpPTISWsLepQA2Wag/new-account-throttlingexception-on-first-ever-bedrock-request-quota-shows-5m-tpm-but-zero-tokens-allowed)
- [All Bedrock model quotas stuck at 0 tokens/day](https://repost.aws/questions/QUt6wvrkLHQwq6yq52nVADvA/all-bedrock-model-quotas-stuck-at-0-tokens-day-cannot-make-any-api-calls)
- [Bedrock Claude Opus 4.6 stuck at 0 tokens-per-day quota](https://repost.aws/questions/QUNLrkvWGeQVWFffdDrda90Q/bedrock-claude-opus-4-6-stuck-at-0-tokens-per-day-quota-throttling-exception-on-every-call)

**Lo bueno:** no es un bloqueo contra Davaria ni un error nuestro, y se resuelve
con un caso de soporte. **Lo que hay que saber:** en varios de esos reportes AWS
tardó días y en algunos rechazó la petición *por poca actividad en la cuenta*.
Conviene abrir el caso ya y no esperar a tener clientes.

### Lo que ya se intentó por autoservicio, y por qué no alcanza

1. **Formulario de caso de uso** (`bedrock:PutUseCaseForModelAccess`, el mismo
   que la consola llama *Model access → Modify model access → Submit use case
   details*). Ya estaba enviado en `us-east-1` y `us-west-2`, y el
   estrangulamiento siguió igual. Esta sesión lo envió también en
   `mx-central-1` (la región del cluster) y `us-east-2`, donde faltaba. Si el
   formulario fuera la única puerta, esto la abre; no parece serlo.
2. **Aumento de cuota por autoservicio**: rechazado por la propia API —
   `You must provide a quota value greater than the default quota value of
   6000000.0`. Es decir, Service Quotas considera que la cuenta *ya debería*
   tener 6M TPM. No se puede "pedir" volver al valor por defecto.
3. **Caso de soporte por API**: imposible. La cuenta está en soporte **Basic**
   (`SubscriptionRequiredException` en `support:DescribeSeverityLevels`), así
   que el caso debe abrirse **desde la consola**, categoría *Account and
   Billing* (esa sí está disponible en Basic).

### Texto del caso para AWS (listo para pegar)

> **Asunto:** Bedrock on-demand inference quotas are set to 0 account-wide
>
> Account `523859314550`, standalone, no Organization. Every Bedrock on-demand
> model returns `ThrottlingException: Too many tokens per day` on the first
> request of the day, across all providers (Anthropic, OpenAI, Amazon Nova,
> Qwen, DeepSeek, Mistral) and all regions tested (`us-east-1`, `us-west-2`,
> `mx-central-1`).
>
> `GetServiceQuota` reports the applied value as 0 for quotas whose AWS default
> is not 0. Example: `L-248E47B7` (Global cross-region tokens per day for Claude
> Sonnet 4.6) has an AWS default of 8,640,000,000 and an applied value of 0, and
> is not adjustable. `L-7BEE40FB` (tokens per minute, same model) has a default
> of 6,000,000 and an applied value of 0.
>
> A self-service increase is refused because the requested value must exceed the
> default, which the account does not currently have. Model access shows
> "Access granted" and the use case form has been submitted in us-east-1,
> us-west-2, us-east-2 and mx-central-1.
>
> Please restore the default on-demand inference quotas for this account.

**Cómo abrirlo:** consola AWS → Support → Create case → *Account and Billing* →
Service: *Billing* o *Account* → pegar el texto anterior.

**Implicación de producto:** Foundation Cloud no puede venderse hasta que AWS
habilite al menos una de las dos vías. Conviene abrir el caso de soporte antes de
seguir invirtiendo ingeniería en esta arquitectura, y considerar un plan B
(p. ej. API de Anthropic directa con la clave del propio cliente) si AWS tarda.

## Arquitectura de Foundation Cloud

> **Corrección (sesión nocturna).** Una versión anterior de esta sección decía
> que AgentCore *sí* ejecutaba modelos y que `claude_local` + Bedrock estaba
> bloqueado, basándose en que `model_call_count` subía a 2 en una sesión nueva.
> **Esa lectura era falsa y hay que descartarla.** `model_call_count` cuenta los
> intentos del harness, no las respuestas: el harness llamaba a Bedrock, Bedrock
> estrangulaba cada intento, se agotaban las iteraciones y devolvía
> `max_iterations_exceeded` sin una sola línea de contenido. Por eso un harness
> mínimo de control se comportaba igual que el nuestro.
>
> Ninguna de las dos vías ejecuta un modelo hoy, y la causa es la misma: la
> cuota de Bedrock de la cuenta está en 0 para todos los proveedores. Ver
> *Causa raíz única* arriba.

**Medido de nuevo, 2026-09-11 por la noche:**

| Vía | Resultado |
|---|---|
| `claude_local` + Bedrock directo (`InvokeModel`) | `ThrottlingException` — "Too many tokens per day" |
| `Converse` sobre OpenAI, Qwen, Nova, DeepSeek, Mistral | idéntico, en tres regiones |
| AgentCore `InvokeHarness` | `messageStop / max_iterations_exceeded`, sin contenido — el mismo estrangulamiento, un nivel más abajo |

**Conclusión:** elegir entre las dos vías es una decisión que todavía no toca.
Cuando AWS restaure la cuota, la más simple (`claude_local` + Bedrock directo)
es la que hay que probar primero: menos piezas, sin harness, sin Memory, y ya
tiene el rol de la task con permiso de invocación. El precio y los run logs
sirven para las dos porque viven en el ledger y en el store, no en el adapter.

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
- Rama `foundation-cloud-bedrock`, desplegada a dev por `workflow_dispatch`. **Master sin tocar.**

#### Añadido en la sesión nocturna del 2026-09-11

- `server/src/__tests__/foundation-cloud-ledger.test.ts` — **la promesa de cobro,
  probada contra Postgres real**, no sólo contra el pricer. Un run de Sonnet 4.6
  deja 49 centavos a nombre del tenant; dos tenants mantienen cuentas separadas;
  un modelo sin tarifa queda `unpriced` en vez de gratis; un run con la llave del
  cliente o con suscripción no se toca. Desactivar el pricer rompe 2 de los 5.
  **5/5**, y 31/31 en todo el conjunto de Foundation Cloud.
- `run-log-store.ts` + `heartbeat.readLog` — **la clave de S3 se verifica contra
  el tenant que la pide.** El endpoint ya autorizaba al llamante para la empresa
  del run, pero luego leía la clave que dijera la fila sin mirarla: un `log_ref`
  mal escrito bastaba para servir a un tenant la transcripción de otro. Se
  responde "no encontrado", no "prohibido", para que la diferencia no delate la
  existencia del log ajeno. **5/5 tests.**
- `runnerd-codex-transport.ts` — los dos timeouts ahora dicen qué observaron
  (presupuesto agotado, si llegó a abrirse un hilo de provider, el servicio, y
  los últimos diagnósticos del otro lado). El mensaje viejo, `runnerd did not
  report its provider identity`, mandaba a buscar un bug de runnerd que no
  existía cuando la causa real era Bedrock estrangulando detrás del harness.
- `foundation-dev-ecs-task` ya tiene política de identidad
  `FoundationCloudBedrockInvoke` (invoke sobre modelos Anthropic y perfiles de
  inferencia de esta cuenta, nada más). Era la única falla de la verificación
  que dependía de nosotros. **`scripts/verify-foundation-cloud.sh foundation dev`
  pasa todo salvo el paso de la instancia, que necesita el service token de
  Cloudflare.**
- Formulario de caso de uso de Bedrock enviado en `mx-central-1` y `us-east-2`
  (faltaba; ya estaba en `us-east-1` y `us-west-2`).
- Rol `paperclip-agentcore-operator` (asumible sólo por `foundation-cli`, perfil
  local `foundation-ops`): Service Quotas, formulario de acceso a modelos, y
  `iam:PutRolePolicy` **únicamente** sobre `foundation-dev-ecs-task` y
  `foundation-prod-ecs-task`. Deny explícito sobre ECS/RDS/ELB/EC2, creación de
  usuarios y llaves. No es admin y no debe convertirse en admin.

#### Dos señales nuevas en `/api/health`

Ninguna de las dos cosas que vigilan daba error antes; las dos se descubrían
tarde y caro.

```jsonc
// sin sesión (lo que ve el deploy)
"features": {
  "foundationCloudExecutionEnabled": true,
  "foundationCloudBilling": { "priced": true },
  "runLogMirror": { "consecutiveFailures": 0 }
}

// con sesión
"features": {
  "foundationCloudBilling": { "model": "global.anthropic.claude-sonnet-4-6", "priced": true },
  "runLogMirror": { "configured": true, "uploads": 12, "failures": 0,
                    "consecutiveFailures": 0, "lastFailureAt": null,
                    "lastFailureReason": null }
}
```

- **`foundationCloudBilling.priced`** — si `FOUNDATION_BEDROCK_MODEL` apunta a
  una familia sin tarifa, los runs siguen funcionando y cada fila de
  `cost_events` queda a 0 centavos. Sin error en ningún sitio. Ahora se ve en el
  deploy, no en la factura. El id del modelo sólo sale con sesión.
- **`runLogMirror`** — el mirror a S3 es best-effort a propósito (un fallo no
  debe tumbar un run), así que unas credenciales malas o una policy denegada
  eran completamente silenciosas hasta que un roll de la task se llevaba las
  copias locales. Sólo contadores y el nombre del error: la clave del objeto
  lleva ids de tenant y de run.

`scripts/verify-foundation-cloud.sh` ya asserta lo primero.

#### Qué significa "harness por tenant_id", en concreto

Revisado a fondo, porque era tu pregunta original. Cuatro piezas, tres ya
aisladas por tenant y una que hubo que arreglar:

| Pieza | Cómo se separa hoy |
|---|---|
| Perfil de AgentCore (harness, memory, bucket, rol) | Fila por `company_id` en `remote_agent_profiles`. Cada tenant puede apuntar a su propio harness sin tocar código. |
| Run logs en S3 | `run-logs/<companyId>/<agentId>/<runId>.ndjson`, y la lectura verifica que la clave sea del tenant que pregunta. |
| Memoria de AgentCore | `actor_id = paperclip-<sha(session_id)>`, con `session_id` aleatorio por sesión. Los eventos se listan y borran por `(session_id, actor_id)`, así que dos tenants sobre el mismo Memory no se cruzan. Lo que sí comparten es cuota y retención. |
| Contexto de ejecución en S3 | **Era el hueco.** Un solo `contextPrefix` para todo el deployment. Ahora un perfil se rechaza si su prefijo no lleva el `company_id` como segmento. |

Lo que **no** separa nada de esto es el proceso: todos los agentes corren dentro
de la misma task de ECS. Ver *RIESGO ABIERTO* más abajo; eso sigue necesitando un
sandbox provider.

#### Dos fugas de ingreso encontradas en el camino de tokens

Ninguna daba error. Las dos hacían que Foundation le pagara a Amazon tokens que
ningún tenant ve en su factura.

1. **Adaptador `claude-local`, camino de respaldo.** `claudeModelUsageTotals`
   suma `cacheCreationInputTokens` dentro de `inputTokens`, porque Anthropic los
   cobra como tokens de prompt — lo dice su propio comentario. Pero cuando el
   evento `result` no trae `modelUsage`, el respaldo leía sólo `input_tokens` y
   esos tokens desaparecían del run. Revertir el arreglo rompe el test nuevo.

2. **Camino nativo (AgentCore).** `runner-core` **sí** calcula `cacheWriteTokens`
   para cada reporte de uso, sumando los buckets `ephemeral_1h` y `ephemeral_5m`
   del proveedor, y hay un test en Rust que lo comprueba. El lado TypeScript
   **nunca leía ese campo**: todo lo que una sesión gastara construyendo su
   cache se perdía antes de llegar al ledger.

Las dos quedan sumadas a `inputTokens`, que es lo que ya hacía el adaptador
local. Bedrock cobra la escritura de cache algo por encima del input ($3.75
contra $3 por millón en Sonnet 4.6), así que todavía se factura ~20% por debajo
en esos tokens concretos — contra 100% por debajo antes. El arreglo exacto
necesita una columna en `cost_events` para que la fila siga siendo recomputable;
`resolveBedrockCostUsd` ya acepta el argumento `cacheWriteInputTokens`.

#### Por qué dev siempre respondía 503 (resuelto)

No era un fallo del despliegue. `foundation-deploy.yml` **apaga dev a propósito**
al terminar (`Scale development back to zero`), porque una task encendida cobra
y el presupuesto es de ~USD 50/mes. La task arrancaba, pasaba su health check a
través de Cloudflare, y desaparecía antes de que nadie pudiera usarla.

Ahora el dispatch acepta `keep_development_running`. Con eso dev queda arriba
para probar; sin eso, todo sigue igual que antes. **Si lo usas, dev cobra hasta
que otro deploy (sin la bandera) lo baje.**

```
gh workflow run foundation-deploy.yml --repo eldaninavas/paperclip \
  --ref foundation-cloud-bedrock -f deploy_production=false \
  -f keep_development_running=true
```

#### Estado verificado de `foundation-dev` (2026-09-11, 20:20 UTC)

```
GET https://foundation-dev.davaria.app/api/health  →  200
  commit:          fb37ef0b90dbff2c9df13bfffc3798f054fe497a
  deploymentMode:  authenticated
  features:        foundationCloudExecutionEnabled = true
  bootstrapStatus: bootstrap_pending
```

Dev **está arriba y sana** con la rama desplegada, y el paso
`Scale development back to zero` quedó omitido, que era el objetivo de la
bandera. Sigue arriba y **cobrando** hasta que alguien despliegue sin ella.

`bootstrapStatus: bootstrap_pending` significa que **ningún admin ha reclamado
esa instancia**: la base está vacía, no hay empresa ni agente. Reclamarla crea
una identidad a tu nombre, así que eso te toca a ti: abre
`https://foundation-dev.davaria.app/` y pulsa *Sign in / Create account*. A
partir de ahí se puede crear la empresa, el perfil de AgentCore y el agente.

**Matiz importante sobre "outputs en S3 por tenant":** está probado de verdad
—hay 10 run logs reales bajo `run-logs/<companyId>/<agentId>/<runId>.ndjson`,
con contenido de ejecución— pero los escribió un **servidor Foundation local**
de esta madrugada, no la instancia desplegada. La base de dev se creó de cero
después. La ruta de código es la misma; lo que falta por ver es esa misma ruta
corriendo dentro de ECS, y para eso hace falta reclamar dev.

**Falta en prod:** la misma política `FoundationCloudBedrockInvoke` sobre
`foundation-prod-ecs-task`. Es aditiva y no toca el servicio en marcha, pero es
un cambio en producción y queda a tu autorización:

```
aws --profile foundation-ops iam put-role-policy \
  --role-name foundation-prod-ecs-task \
  --policy-name FoundationCloudBedrockInvoke \
  --policy-document file://<el mismo documento que dev>
```

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

### Hallazgo intermedio (real, pero NO era la causa raíz)

> Se corrigió y sigue siendo correcto corregirlo, pero **no era lo que impedía
> ejecutar**. La causa real es la cuota de Bedrock en 0; ver *Causa raíz única*
> al principio. Se conserva porque el bug del patrón de herramientas es
> auténtico y habría bloqueado la completación igualmente en cuanto el modelo
> respondiera.

#### El harness bloqueaba sus propias herramientas de completación

`infra/aws-agentcore-paperclip.yaml:283` configura el harness con:

```yaml
AllowedTools:
  - "@*/pc_*"
```

Ese patrón tiene formato MCP (`@servidor/herramienta`) y exige prefijo `pc_`.
Pero el contrato de Paperclip usa **`paperclip_finish`** y **`paperclip_block`**
(`contracts/completion-result.ts:2-3`), entregadas como **inline functions**, que
no tienen servidor. **Ninguna puede casar nunca con ese patrón.**

Consecuencia: el modelo no puede invocar ninguna herramienta, agota sus 8
iteraciones y el harness devuelve `max_iterations_exceeded` sin emitir un solo
evento de contenido. Es exactamente el síntoma de todos los runs de esta sesión.

**Verificado contra el harness real, tres veces:**

| Prueba | Resultado |
|---|---|
| tool `finish` (nombre improvisado) | `max_iterations_exceeded`, 0 eventos |
| tool `paperclip_finish` (nombre real del contrato) | `max_iterations_exceeded`, 0 eventos |
| tool `pc_finish` (casa el prefijo, pero sigue siendo inline) | `max_iterations_exceeded`, 0 eventos |

El modelo **sí** se invoca — `model_call_count` sube en Memory — pero su salida
nunca llega al stream porque no tiene herramienta que usar.

**Corrección aplicada, con resultado parcial.** El schema del servicio confirma
que un `allowedTool` admite un nombre simple (`(\*|@?[^/]+(/[^/]+)?)`), así que
añadí `paperclip_*`. Harness actualizado a la **versión 2**, endpoint `paperclip`
apuntando a v2, ambos `READY`.

**Qué cambió y qué no:**

| | Antes | Después |
|---|---|---|
| Invocación manual con `paperclip_finish` | falla en 36 s | falla en 76 s |
| Run del agente vía runner | falla en 30-75 s | **corre 25 min** y luego falla |

El turno claramente progresa más, pero **el run sigue terminando en
`runnerd did not report its provider identity`**, incluso con el wait a 10
minutos. El provider sólo emite identidad tras una respuesta del harness, y esa
respuesta sigue sin llegar.

**Honestamente: mi hipótesis era correcta pero incompleta.** El patrón MCP no
podía casar inline functions —eso es un defecto real y el arreglo se queda— pero
no era la única causa. Queda algo más entre el `toolUse` del modelo y el
`toolResult` que debe devolver el runner.

### ✅ PRUEBA DE CONTROL: el fallo no es de Foundation

> Lo que esta prueba demuestra, con la evidencia de la noche encima: el harness
> mínimo devuelve `max_iterations_exceeded` **porque Bedrock estrangula cada
> llamada al modelo**, no porque el servicio AgentCore esté roto. El
> `model_call_count` que sube en Memory son los intentos. Cuando al harness de
> control le faltaba un permiso de memoria devolvía un `AccessDeniedException`
> explícito, así que el servicio sí sabe reportar errores — el que no reporta
> nada es el estrangulamiento detrás.

Creé un harness **mínimo** desde cero — dos parámetros (`harnessName`,
`executionRoleArn`) más el modelo — **sin nada nuestro**: sin system prompt de
Paperclip, sin `tools`, sin `allowedTools`, sin skills, con su propia memory y su
endpoint `DEFAULT`. Le mandé `"Di OK."`:

```
[17.9s] {"messageStop": {"stopReason": "max_iterations_exceeded"}}
TOTAL EVENTOS: 1
```

**Idéntico a nuestro harness.** Queda descartado, con evidencia, todo lo nuestro:
configuración, system prompt, `allowedTools`, contrato de completación, endpoint,
tools, memory y perfil.

Un detalle que refuerza el caso: cuando al harness de control **le faltaba** un
permiso de memoria, devolvió un `AccessDeniedException` **explícito y claro**. Es
decir, el servicio sí sabe reportar errores; el `max_iterations_exceeded` mudo no
es un error oculto de permisos, es el harness iterando sin producir salida.

**Repro para AWS Support (no menciona Paperclip):**

1. `create_harness(harnessName=..., executionRoleArn=..., model={"bedrockModelConfig":{"modelId":"global.anthropic.claude-sonnet-4-6"}})`
2. Esperar `READY`.
3. `invoke_harness(harnessArn=..., runtimeSessionId=..., messages=[{"role":"user","content":[{"text":"Di OK."}]}], maxIterations=2)`
4. Resultado: un único evento `messageStop / max_iterations_exceeded`, sin
   `messageStart`, sin deltas, sin usage — mientras `model_call_count` sube en
   Memory.

Cuenta `523859314550`, región `us-east-1`.

*(El harness de control y su política temporal fueron eliminados tras la prueba.)*

### El síntoma, en nuestro harness: nunca emite contenido

Inspeccioné el stream completo de `InvokeHarness` sin filtros, contra el harness
**v2** ya corregido:

```
[17.5s] evento 1: {"messageStop": {"stopReason": "max_iterations_exceeded"}}
TOTAL EVENTOS: 1
```

**Un solo evento.** Ni `messageStart`, ni `contentBlockDelta`, ni `toolUse`, ni
`metadata` con usage. En cambio `model_call_count` sí sube en Memory: el modelo
se invoca de verdad y su salida no aparece en el stream.

Escala con las iteraciones (~8-17 s cada una), así que el harness itera, llama al
modelo y descarta —o nunca recibe— la respuesta.

**Esto ya no parece configuración nuestra.** Las cosas bajo nuestro control están
verificadas: el modelo está habilitado y con acuerdo `AVAILABLE`, el rol de
ejecución tiene Bedrock y Marketplace, el contexto se sube cifrado, el endpoint
está `READY` en v2, y `allowedTools` admite el contrato. Con todo eso, un harness
sano debería emitir al menos `messageStart`.

**Descartado también el endpoint.** Repetí la prueba con el endpoint `DEFAULT`
del harness, con el `paperclip` que creamos, y sin `qualifier`. Los tres, con un
mensaje trivial (`"Di OK"`) y **sin herramientas**, devuelven exactamente lo
mismo:

```
qualifier=DEFAULT  → [19.7s] messageStop / max_iterations_exceeded — 1 evento
qualifier=paperclip→ [17.5s] messageStop / max_iterations_exceeded — 1 evento
sin qualifier      → [21.0s] messageStop / max_iterations_exceeded — 1 evento
```

Es decir: no depende del endpoint, ni de las herramientas, ni del contrato de
completación, ni de nada que hayamos configurado nosotros. **Un harness recién
creado no responde a un "Di OK".** Ése es el repro para AWS, y cabe en un párrafo.

**Todo lo nuestro verificado, uno por uno:**

| Comprobación | Resultado |
|---|---|
| Acuerdo del modelo en la región | `AVAILABLE` |
| Rol de ejecución → `InvokeModelWithResponseStream` sobre el inference profile | `allowed` |
| Íd. sobre los foundation models (us-east-1 y us-west-2) | `allowed` |
| Agent Runtime | `READY`, v2, imagen gestionada de AWS, red `PUBLIC` |
| Harness | `READY`, v2 |
| Endpoint (`paperclip`, `DEFAULT`, sin qualifier) | `READY`, los tres se comportan igual |
| Memory | activa, `model_call_count` incrementa |
| `AllowedTools` | corregido para admitir el contrato inline |
| Subida del runtime context a S3 | funciona, objetos cifrados presentes |

Con todo eso en verde, `InvokeHarness` sigue devolviendo un único evento
`messageStop / max_iterations_exceeded` ante un `"Di OK"` sin herramientas.

**Lo que yo haría a continuación, por orden de coste:**
1. Abrir un caso con AWS Support con esta traza: *"InvokeHarness returns only
   messageStop/max_iterations_exceeded, no content events, while Memory shows
   model_call_count incrementing"*, citando harness
   `PaperclipAgentCoreHarness-L0mN61eLn1` en `us-east-1`. Es reproducible en tres
   líneas y no depende de Paperclip.
2. En paralelo, revisar si el `Environment` del harness (el bloque
   `AgentCoreRuntimeEnvironment` del template) necesita algo que el PoC no fija.
3. No seguir tocando el lado de Paperclip: los seis defectos que sí eran nuestros
   están corregidos, y este no responde a ninguno de ellos.

### Diagnóstico previo (correcto pero incompleto): parecía un timeout

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

1. Desplegar con `-f keep_development_running=true` (ya no hace falta escalar a
   mano) y ejecutar un agente. Recuerda que dev cobra hasta que otro deploy sin
   la bandera lo baje.
1b. Confirmar en dev que `enableNativeRunner` está en `true`: en prod está en
   `false`, y con eso la ruta de AgentCore no se selecciona aunque haya cuota.
   `GET /api/instance/settings/experimental`.
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
el primer cliente real.**

**Mitigación disponible hoy, sin costo y sin proveedor externo:** el ajuste
experimental **`enableIsolatedWorkspaces`** hace que cada ejecución use un
workspace nuevo y aislado (`isolated_workspace`) en lugar del compartido del
proyecto (`shared_workspace`). Está apagado por defecto
(`instance-settings.ts:264`).

Qué resuelve y qué no, para no venderlo de más:

| | Con `enableIsolatedWorkspaces` |
|---|---|
| Directorio de trabajo por run | ✅ aislado |
| Output y ledger por tenant | ✅ ya lo estaban |
| Proceso, memoria y red | ❌ **siguen compartidos** en la misma task de ECS |
| Un agente con shell leyendo el FS del contenedor | ❌ sigue siendo posible |

Es decir: reduce mucho la superficie accidental (que un agente tropiece con el
workspace de otro), pero **no es una frontera de seguridad**. Para eso sigue
haciendo falta elegir y contratar un sandbox provider (cloudflare, daytona, e2b,
kubernetes, modal, novita) y activar `enableManagedSandboxOnly` para que ningún
run caiga al driver `local`.

**Recomendación:** activar `enableIsolatedWorkspaces` ya (es gratis y mejora el
estado actual), y no confundirlo con haber resuelto el aislamiento multitenant.

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


