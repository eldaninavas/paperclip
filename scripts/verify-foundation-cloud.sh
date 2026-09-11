#!/usr/bin/env bash
# Verify the Foundation Cloud execution path end to end, after a deploy.
#
# Read-only against AWS. It answers the three questions a deploy cannot: does
# the task have the credentials to reach Bedrock, is a tenant's agent output
# actually landing in object storage, and did the run produce a priced ledger
# row rather than a zero-cent one.
#
# Usage: bash scripts/verify-foundation-cloud.sh [aws-profile] [environment]
set -uo pipefail

PROFILE="${1:-foundation}"
ENVIRONMENT="${2:-dev}"
REGION="mx-central-1"
BUCKET="paperclip-agentcore-foundation-runlogs-${ENVIRONMENT}"
TASK_ROLE="foundation-${ENVIRONMENT}-ecs-task"

pass=0
fail=0
ok()   { printf '  \033[32mOK\033[0m   %s\n' "$1"; pass=$((pass + 1)); }
bad()  { printf '  \033[31mFALLA\033[0m %s\n' "$1"; fail=$((fail + 1)); }
note() { printf '       %s\n' "$1"; }

A() { aws --profile "$PROFILE" --no-cli-pager "$@" 2>&1; }

echo "Foundation Cloud — verificación (${ENVIRONMENT}, ${REGION})"
echo

echo "1a. Escritura de run logs en S3 (via bucket policy, no requiere IAM)"
# The bucket policy grants the task roles directly, so this works even with an
# empty identity policy — a resource-based grant is sufficient within one
# account. Simulated against the live bucket policy rather than assumed.
policy_file="$(mktemp)"
if A --region "$REGION" s3api get-bucket-policy --bucket "$BUCKET" --query Policy --output text > "$policy_file" 2>/dev/null \
   && [[ -s "$policy_file" ]]; then
  decision="$(A iam simulate-principal-policy \
    --policy-source-arn "arn:aws:iam::523859314550:role/${TASK_ROLE}" \
    --action-names s3:PutObject \
    --resource-arns "arn:aws:s3:::${BUCKET}/run-logs/c/a/r.ndjson" \
    --resource-policy "file://${policy_file}" \
    --resource-owner arn:aws:iam::523859314550:root \
    --query 'EvaluationResults[0].EvalDecision' --output text)"
  [[ "$decision" == "allowed" ]] \
    && ok "$TASK_ROLE puede escribir run logs (s3:PutObject → allowed)" \
    || bad "s3:PutObject → $decision pese a la bucket policy"
else
  bad "el bucket $BUCKET no tiene bucket policy: la task no podrá escribir run logs"
fi
rm -f "$policy_file"
echo

echo "1b. Acceso a Bedrock (requiere política de identidad; Bedrock no admite policy de recurso)"
policies="$(A iam list-role-policies --role-name "$TASK_ROLE" --query 'PolicyNames' --output text)"
attached="$(A iam list-attached-role-policies --role-name "$TASK_ROLE" --query 'AttachedPolicies[].PolicyName' --output text)"
if [[ -z "${policies// }" && -z "${attached// }" ]]; then
  bad "$TASK_ROLE no tiene política de identidad: el contenedor no puede invocar Bedrock."
  note "Es el único paso que falta. Ver CLAUDE-HANDOFF.md, sección BLOQUEADO."
else
  decision="$(A iam simulate-principal-policy \
    --policy-source-arn "arn:aws:iam::523859314550:role/${TASK_ROLE}" \
    --action-names bedrock:InvokeModelWithResponseStream --resource-arns "*" \
    --query 'EvaluationResults[0].EvalDecision' --output text)"
  [[ "$decision" == "allowed" ]] \
    && ok "bedrock:InvokeModelWithResponseStream → allowed" \
    || bad "bedrock:InvokeModelWithResponseStream → $decision"
fi
echo

echo "2. Modelo habilitado en la región del cluster"
avail="$(A --region "$REGION" bedrock get-foundation-model-availability \
  --model-id anthropic.claude-sonnet-4-6 --query 'agreementAvailability.status' --output text)"
[[ "$avail" == "AVAILABLE" ]] \
  && ok "acuerdo del modelo: AVAILABLE en $REGION" \
  || bad "acuerdo del modelo: $avail (habilítalo invocándolo una vez desde la consola)"
echo

echo "3. Outputs de agentes en S3, segmentados por tenant"
if A --region "$REGION" s3api head-bucket --bucket "$BUCKET" >/dev/null; then
  ok "bucket $BUCKET accesible"
  objects="$(A --region "$REGION" s3 ls "s3://${BUCKET}/run-logs/" --recursive | head -20)"
  if [[ -z "${objects// }" ]]; then
    bad "no hay run logs todavía: ejecuta un agente y vuelve a correr esto."
    note "Ruta esperada: run-logs/<companyId>/<agentId>/<runId>.ndjson"
  else
    ok "run logs presentes:"
    printf '%s\n' "$objects" | awk '{print "         " $4}' | head -10
    tenants="$(printf '%s\n' "$objects" | awk '{print $4}' | cut -d/ -f2 | sort -u | wc -l | tr -d ' ')"
    note "tenants distintos con output: $tenants"
  fi
else
  bad "bucket $BUCKET inaccesible"
fi
echo

echo "4. Ledger: consulta para correr contra la base de la instancia"
cat <<'SQL'
       -- Un run de Foundation Cloud correcto: metered_api, biller aws_bedrock,
       -- tokens > 0 y cost_cents > 0. Si cost_cents = 0 con tokens > 0, el
       -- pricer no se aplicó y ese consumo no es facturable.
       SELECT company_id, model, biller, billing_type, cost_status,
              input_tokens, cached_input_tokens, output_tokens, cost_cents
       FROM cost_events
       WHERE biller = 'aws_bedrock'
       ORDER BY occurred_at DESC
       LIMIT 20;
SQL
echo
echo "Resumen: ${pass} OK, ${fail} fallas"
[[ "$fail" -eq 0 ]] || exit 1
