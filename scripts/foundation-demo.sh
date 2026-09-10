#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BASE_URL="${FOUNDATION_DEMO_URL:-http://localhost:3100}"
COMPANY_NAME="Nova Finanzas"
TASK_IDENTIFIER="NOV-1"
DOSSIER_TITLE="Cierre Ejecutivo — Control de Gastos Q3"
OUTPUT_DIR="$REPO_DIR/output/demo"
MODE="${1:---check}"

if [[ -x /opt/homebrew/opt/node@24/bin/node ]]; then
  NODE_BIN=/opt/homebrew/opt/node@24/bin/node
else
  NODE_BIN="$(command -v node)"
fi

json_read() {
  local expression="$1"
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const fn = new Function("data", `return (${process.argv[1]})`);
    const value = fn(data);
    if (value === undefined || value === null || value === false) process.exit(2);
    process.stdout.write(String(value));
  ' "$expression"
}

fetch_json() {
  curl --fail --silent --show-error --max-time 10 "$BASE_URL$1"
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

check_demo() {
  command -v curl >/dev/null || fail "curl is required"

  local health_json status deployment backup_status company_json company_id
  local task_json task_status task_title work_products_json deliverable_path
  local dossiers_json dossier_id dossier_status

  health_json="$(fetch_json /api/health)" || fail "Foundation is not responding at $BASE_URL"
  status="$(printf '%s' "$health_json" | json_read 'data.status')" || fail "Health response is invalid"
  deployment="$(printf '%s' "$health_json" | json_read 'data.deploymentMode')" || fail "Deployment mode is missing"
  backup_status="$(printf '%s' "$health_json" | json_read 'data.databaseBackup?.status ?? "unknown"')" || true
  [[ "$status" == "ok" ]] || fail "Foundation health is $status"

  company_json="$(fetch_json /api/companies)"
  company_id="$(printf '%s' "$company_json" | json_read 'data.find((company) => company.name === "Nova Finanzas")?.id')" \
    || fail "The Nova Finanzas demo company is missing"

  task_json="$(fetch_json "/api/issues/$TASK_IDENTIFIER")" || fail "Task $TASK_IDENTIFIER is missing"
  task_status="$(printf '%s' "$task_json" | json_read 'data.status')" || fail "Task status is missing"
  task_title="$(printf '%s' "$task_json" | json_read 'data.title')" || fail "Task title is missing"
  [[ "$task_status" == "done" ]] || fail "$TASK_IDENTIFIER must be done, but is $task_status"

  work_products_json="$(fetch_json "/api/issues/$TASK_IDENTIFIER/work-products")"
  deliverable_path="$(printf '%s' "$work_products_json" | json_read \
    'data.find((product) => product.isPrimary && product.type === "artifact" && product.metadata?.contentType === "application/pdf")?.metadata?.contentPath')" \
    || fail "$TASK_IDENTIFIER must have a primary PDF deliverable"

  dossiers_json="$(fetch_json "/api/companies/$company_id/assurance/dossiers")"
  dossier_id="$(printf '%s' "$dossiers_json" | json_read 'data.find((dossier) => dossier.title === "Cierre Ejecutivo — Control de Gastos Q3")?.id')" \
    || fail "The executive Assurance dossier is missing"
  dossier_status="$(printf '%s' "$dossiers_json" | json_read 'data.find((dossier) => dossier.id === "'"$dossier_id"'")?.status')" \
    || fail "The dossier status is missing"
  [[ "$dossier_status" == "sealed" ]] || fail "The executive dossier must be sealed, but is $dossier_status"

  mkdir -p "$OUTPUT_DIR"
  curl --fail --silent --show-error --max-time 20 \
    "$BASE_URL$deliverable_path" \
    --output "$OUTPUT_DIR/Informe-ejecutivo-Nova-Finanzas.pdf"
  [[ "$(head -c 4 "$OUTPUT_DIR/Informe-ejecutivo-Nova-Finanzas.pdf")" == "%PDF" ]] \
    || fail "The primary task deliverable is not a valid PDF"

  curl --fail --silent --show-error --max-time 20 \
    "$BASE_URL/api/assurance/dossiers/$dossier_id/report.pdf" \
    --output "$OUTPUT_DIR/Cierre-Ejecutivo-Control-Gastos-Q3.pdf"
  strings "$OUTPUT_DIR/Cierre-Ejecutivo-Control-Gastos-Q3.pdf" | grep -q "EXECUTIVE SUMMARY" \
    || fail "The Assurance download is still using the legacy PDF renderer"

  local public_id
  public_id="$(printf '%s' "$dossiers_json" | json_read 'data.find((dossier) => dossier.id === "'"$dossier_id"'")?.publicId')" \
    || fail "The public verification ID is missing"

  printf '\nFoundation demo is ready.\n\n'
  printf '  Server:       %s (%s)\n' "$status" "$deployment"
  printf '  DB backups:   %s\n' "$backup_status"
  printf '  Company:      %s\n' "$COMPANY_NAME"
  printf '  Task:         %s — %s (%s)\n' "$TASK_IDENTIFIER" "$task_title" "$task_status"
  printf '  Dossier:      %s (%s)\n' "$DOSSIER_TITLE" "$dossier_status"
  printf '  Deliverable:  %s\n' "$OUTPUT_DIR/Informe-ejecutivo-Nova-Finanzas.pdf"
  printf '  Assurance:    %s\n\n' "$OUTPUT_DIR/Cierre-Ejecutivo-Control-Gastos-Q3.pdf"
  printf 'Demo URLs:\n'
  printf '  Project:      %s/NOV/projects/control-de-gastos-q3/issues\n' "$BASE_URL"
  printf '  Task:         %s/NOV/issues/%s\n' "$BASE_URL" "$TASK_IDENTIFIER"
  printf '  Dossier:      %s/NOV/assurance/dossiers/%s\n' "$BASE_URL" "$dossier_id"
  printf '  Verification: %s/verify/%s\n\n' "$BASE_URL" "$public_id"

  DEMO_COMPANY_ID="$company_id"
  DEMO_DOSSIER_ID="$dossier_id"
  DEMO_PUBLIC_ID="$public_id"
}

prepare_demo() {
  check_demo
  printf 'Creating a fresh database backup...\n'
  (
    cd "$REPO_DIR"
    PATH="$(dirname "$NODE_BIN"):$PATH" pnpm db:backup
  )
  printf '\nPreparation complete. No demo records were modified.\n'
}

open_demo() {
  check_demo
  if [[ "$(uname -s)" != "Darwin" ]]; then
    fail "--open currently supports macOS only"
  fi
  open -a "Brave Browser" "$BASE_URL/NOV/projects/control-de-gastos-q3/issues"
  open -a "Brave Browser" "$BASE_URL/NOV/issues/$TASK_IDENTIFIER"
  open -a "Brave Browser" "$BASE_URL/NOV/assurance/dossiers/$DEMO_DOSSIER_ID"
  open -a "Brave Browser" "$BASE_URL/verify/$DEMO_PUBLIC_ID"
  printf 'Opened the four read-only demo stops in Brave.\n'
}

case "$MODE" in
  --check)
    check_demo
    ;;
  --prepare)
    prepare_demo
    ;;
  --open)
    open_demo
    ;;
  *)
    printf 'Usage: %s [--check|--prepare|--open]\n' "$0" >&2
    exit 2
    ;;
esac
