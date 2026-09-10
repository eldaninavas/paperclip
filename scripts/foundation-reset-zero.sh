#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PAPERCLIP_ROOT="${PAPERCLIP_HOME:-$HOME/.paperclip}"
INSTANCE_ID="${PAPERCLIP_INSTANCE_ID:-default}"
INSTANCE_ROOT="$PAPERCLIP_ROOT/instances/$INSTANCE_ID"
ARCHIVE_ROOT="$PAPERCLIP_ROOT/reset-archives"
BASE_URL="${FOUNDATION_RESET_URL:-http://127.0.0.1:3100}"
MODE="${1:---plan}"
RESTORE_SOURCE="${2:-}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_PATH="$ARCHIVE_ROOT/${INSTANCE_ID}-before-zero-$STAMP"
RESET_IN_PROGRESS=0

if [[ -x /opt/homebrew/opt/node@24/bin/node ]]; then
  NODE_BIN=/opt/homebrew/opt/node@24/bin/node
else
  NODE_BIN="$(command -v node)"
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_safe_target() {
  [[ "$INSTANCE_ID" == "default" ]] \
    || fail "This reset is intentionally restricted to PAPERCLIP_INSTANCE_ID=default"
  [[ "$INSTANCE_ROOT" == "$HOME/.paperclip/instances/default" ]] \
    || fail "Refusing unexpected instance path: $INSTANCE_ROOT"
  [[ -z "${DATABASE_URL:-}" ]] \
    || fail "DATABASE_URL is set. This script only resets the embedded default database"
  git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || fail "Run this script from the canonical Foundation repository"
  [[ -d "$INSTANCE_ROOT" ]] \
    || fail "Instance root does not exist: $INSTANCE_ROOT"
}

health_json() {
  curl --fail --silent --show-error --max-time 5 "$BASE_URL/api/health"
}

companies_json() {
  curl --fail --silent --show-error --max-time 5 "$BASE_URL/api/companies"
}

company_count() {
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const companies = JSON.parse(fs.readFileSync(0, "utf8"));
    if (!Array.isArray(companies)) process.exit(2);
    process.stdout.write(String(companies.length));
  '
}

wait_for_server_down() {
  for _ in {1..30}; do
    if ! health_json >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

wait_for_server_up() {
  for _ in {1..90}; do
    if health_json >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

stop_server() {
  (
    cd "$REPO_DIR"
    pnpm dev:stop
  )
  wait_for_server_down || fail "Foundation did not stop cleanly"
}

stop_embedded_postgres() {
  local pid command
  local -a postgres_pids=()

  while read -r pid command; do
    if [[ "$command" == *"/postgres -D $INSTANCE_ROOT/db "* ]]; then
      postgres_pids+=("$pid")
    fi
  done < <(ps -Ao pid=,command=)

  if (( ${#postgres_pids[@]} == 0 )); then return 0; fi

  kill -TERM "${postgres_pids[@]}"
  for _ in {1..30}; do
    local alive=0
    for pid in "${postgres_pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then alive=1; fi
    done
    if [[ "$alive" == "0" ]]; then return 0; fi
    sleep 1
  done
  return 1
}

start_server() {
  local log_path="$INSTANCE_ROOT/reset-startup.log"
  mkdir -p "$INSTANCE_ROOT"
  chmod 700 "$INSTANCE_ROOT"
  (
    cd "$REPO_DIR"
    nohup pnpm dev >"$log_path" 2>&1 &
  )
  if ! wait_for_server_up; then
    printf 'Foundation did not start; inspect %s\n' "$log_path" >&2
    return 1
  fi
}

restore_runtime_configuration() {
  # A factory reset removes tenant data, not the local installation's ability
  # to start agents. Preserve only host-level configuration and encryption
  # material; no database, company, project, issue, agent, or artifact data is
  # copied into the fresh instance.
  if [[ -f "$ARCHIVE_PATH/config.json" ]]; then
    cp "$ARCHIVE_PATH/config.json" "$INSTANCE_ROOT/config.json"
  fi
  if [[ -f "$ARCHIVE_PATH/.env" ]]; then
    cp "$ARCHIVE_PATH/.env" "$INSTANCE_ROOT/.env"
    chmod 600 "$INSTANCE_ROOT/.env"
  fi
  if [[ -d "$ARCHIVE_PATH/secrets" ]]; then
    mkdir -p "$INSTANCE_ROOT/secrets"
    cp -R "$ARCHIVE_PATH/secrets/." "$INSTANCE_ROOT/secrets/"
    chmod 700 "$INSTANCE_ROOT/secrets"
  fi
}

confirm_phrase() {
  local expected="$1"
  local entered
  [[ -t 0 ]] || fail "Interactive confirmation is required"
  printf '\nType exactly: %s\n> ' "$expected"
  IFS= read -r entered
  [[ "$entered" == "$expected" ]] || fail "Confirmation did not match; nothing changed"
}

rollback_failed_reset() {
  local exit_code="${1:-1}"
  trap - EXIT INT TERM
  if [[ "$RESET_IN_PROGRESS" != "1" ]]; then return "$exit_code"; fi

  set +e
  printf '\nReset verification failed. Restoring the previous instance automatically...\n' >&2
  (
    cd "$REPO_DIR"
    pnpm dev:stop
  ) >/dev/null 2>&1
  stop_embedded_postgres >/dev/null 2>&1 || true
  mkdir -p "$ARCHIVE_ROOT"
  if [[ -d "$INSTANCE_ROOT" ]]; then
    mv "$INSTANCE_ROOT" "$ARCHIVE_ROOT/${INSTANCE_ID}-failed-empty-$STAMP"
  fi
  if [[ -d "$ARCHIVE_PATH" ]]; then
    mv "$ARCHIVE_PATH" "$INSTANCE_ROOT"
    start_server
  fi
  printf 'Previous instance restored after failed reset.\n' >&2
  exit "$exit_code"
}

plan_reset() {
  assert_safe_target
  local count="unavailable"
  if current_companies="$(companies_json 2>/dev/null)"; then
    count="$(printf '%s' "$current_companies" | company_count)"
  fi

  printf '\nFoundation zero-reset plan\n\n'
  printf '  Repository:     %s\n' "$REPO_DIR"
  printf '  Instance:       %s\n' "$INSTANCE_ID"
  printf '  Target:         %s\n' "$INSTANCE_ROOT"
  printf '  Current tenants:%s\n' " $count"
  printf '  Archive target: %s\n' "$ARCHIVE_PATH"
  printf '  Expected result: HTTP health=ok and /api/companies=[]\n\n'
  printf 'Nothing has been changed. To proceed, run:\n'
  printf '  %s --execute\n' "$0"
}

execute_reset() {
  assert_safe_target
  health_json >/dev/null || fail "Foundation must be healthy before reset"
  local before_companies before_count
  before_companies="$(companies_json)"
  before_count="$(printf '%s' "$before_companies" | company_count)"
  confirm_phrase "RESET default TO ZERO"

  printf '\nCreating a logical database backup...\n'
  (
    cd "$REPO_DIR"
    pnpm db:backup
  )

  mkdir -p "$ARCHIVE_ROOT"
  chmod 700 "$ARCHIVE_ROOT"
  [[ ! -e "$ARCHIVE_PATH" ]] || fail "Archive target already exists: $ARCHIVE_PATH"

  stop_server
  stop_embedded_postgres || fail "Embedded PostgreSQL did not stop cleanly"
  mv "$INSTANCE_ROOT" "$ARCHIVE_PATH"
  RESET_IN_PROGRESS=1
  trap 'rollback_failed_reset $?' EXIT
  trap 'exit 130' INT TERM

  mkdir -p "$INSTANCE_ROOT"
  chmod 700 "$INSTANCE_ROOT"
  restore_runtime_configuration
  start_server || fail "Fresh Foundation instance did not start"

  local after_companies after_count
  after_companies="$(companies_json)"
  after_count="$(printf '%s' "$after_companies" | company_count)"
  [[ "$after_count" == "0" ]] || fail "Fresh instance contains $after_count tenant(s), expected zero"

  RESET_IN_PROGRESS=0
  trap - EXIT INT TERM
  printf '\nFoundation started from zero successfully.\n\n'
  printf '  Previous tenants: %s\n' "$before_count"
  printf '  Current tenants:  %s\n' "$after_count"
  printf '  Archived state:   %s\n' "$ARCHIVE_PATH"
  printf '  Application:      %s\n\n' "$BASE_URL"
  printf 'To restore the archived state later:\n'
  printf '  %s --restore %q\n' "$0" "$ARCHIVE_PATH"
}

restore_archive() {
  assert_safe_target
  [[ -n "$RESTORE_SOURCE" ]] || fail "--restore requires an archive path"
  [[ "$RESTORE_SOURCE" == "$ARCHIVE_ROOT/"* ]] \
    || fail "Restore source must be under $ARCHIVE_ROOT"
  [[ -d "$RESTORE_SOURCE/db" ]] \
    || fail "Restore archive does not contain an embedded database: $RESTORE_SOURCE"
  confirm_phrase "RESTORE default FROM ARCHIVE"

  local displaced="$ARCHIVE_ROOT/${INSTANCE_ID}-before-restore-$STAMP"
  stop_server
  stop_embedded_postgres || fail "Embedded PostgreSQL did not stop cleanly"
  mv "$INSTANCE_ROOT" "$displaced"
  mv "$RESTORE_SOURCE" "$INSTANCE_ROOT"
  if ! start_server; then
    set +e
    stop_embedded_postgres >/dev/null 2>&1 || true
    mv "$INSTANCE_ROOT" "$RESTORE_SOURCE"
    mv "$displaced" "$INSTANCE_ROOT"
    start_server
    fail "Archive restore failed; the pre-restore instance was recovered"
  fi

  printf '\nArchived Foundation state restored.\n\n'
  printf '  Restored from:    %s\n' "$RESTORE_SOURCE"
  printf '  Replaced state:   %s\n' "$displaced"
  printf '  Current tenants:  %s\n' "$(companies_json | company_count)"
}

case "$MODE" in
  --plan)
    plan_reset
    ;;
  --execute)
    execute_reset
    ;;
  --restore)
    restore_archive
    ;;
  *)
    printf 'Usage: %s [--plan|--execute|--restore ARCHIVE_PATH]\n' "$0" >&2
    exit 2
    ;;
esac
