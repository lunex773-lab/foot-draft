#!/usr/bin/env bash
# Prepares the Cloudflare resources of one environment and writes their URLs.
#
#   .github/scripts/cf-prepare.sh <staging|production>
#
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (GitHub secrets).
# Idempotent: creates what is missing, reuses what exists.
#   - D1 database      football-draft-<env>   (id written into apps/api/wrangler.toml on the runner only)
#   - Pages project    web:   football-draft-<env>, admin: football-draft-admin-<env>
#   - workers.dev URL  of the API worker (name from apps/api/wrangler.toml)
# Outputs (GITHUB_OUTPUT): d1_id, api_url, web_url, admin_url, web_project, admin_project
set -euo pipefail

ENV_NAME="${1:?usage: cf-prepare.sh <staging|production>}"
case "$ENV_NAME" in staging | production) ;; *) echo "unknown environment: $ENV_NAME" >&2; exit 1 ;; esac
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is not set (GitHub secret)}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is not set (GitHub secret)}"
API_BASE="${CF_API_BASE:-https://api.cloudflare.com/client/v4}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WRANGLER_TOML="$ROOT/apps/api/wrangler.toml"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"

# cf <method> <path> [json-body] -> response body; fails on success=false unless ALLOW_FAIL=1
cf() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -X "$method" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")
  [ -n "$body" ] && args+=(--data "$body")
  local res
  res="$(curl "${args[@]}" "$API_BASE$path")"
  if [ "${ALLOW_FAIL:-0}" != "1" ] && [ "$(jq -r '.success' <<<"$res")" != "true" ]; then
    echo "Cloudflare API error: $method $path" >&2
    jq -c '.errors' <<<"$res" >&2 || echo "$res" >&2
    exit 1
  fi
  printf '%s' "$res"
}

ACC="/accounts/$CLOUDFLARE_ACCOUNT_ID"

# ---------------------------------------------------------------- D1
D1_NAME="football-draft-$ENV_NAME"
D1_ID="$(cf GET "$ACC/d1/database?name=$D1_NAME" | jq -r --arg n "$D1_NAME" '[.result[]? | select(.name == $n)][0].uuid // empty')"
if [ -z "$D1_ID" ]; then
  echo "creating D1 database $D1_NAME"
  D1_ID="$(cf POST "$ACC/d1/database" "{\"name\":\"$D1_NAME\"}" | jq -r '.result.uuid')"
fi
echo "D1 $D1_NAME = $D1_ID"
PLACEHOLDER="REPLACE_WITH_$(tr '[:lower:]' '[:upper:]' <<<"$ENV_NAME")_DATABASE_ID"
if grep -q "$PLACEHOLDER" "$WRANGLER_TOML"; then
  sed -i "s/$PLACEHOLDER/$D1_ID/" "$WRANGLER_TOML"
fi

# ---------------------------------------------------------------- Pages
pages_subdomain() {
  local name="$1" res
  res="$(ALLOW_FAIL=1 cf GET "$ACC/pages/projects/$name")"
  if [ "$(jq -r '.success' <<<"$res")" != "true" ]; then
    echo "creating Pages project $name" >&2
    res="$(cf POST "$ACC/pages/projects" "{\"name\":\"$name\",\"production_branch\":\"main\"}")"
  fi
  jq -r '.result.subdomain' <<<"$res"
}
WEB_PROJECT="football-draft-$ENV_NAME"
ADMIN_PROJECT="football-draft-admin-$ENV_NAME"
WEB_HOST="$(pages_subdomain "$WEB_PROJECT")"
ADMIN_HOST="$(pages_subdomain "$ADMIN_PROJECT")"

# ---------------------------------------------------------------- workers.dev
WORKERS_SUB="$(ALLOW_FAIL=1 cf GET "$ACC/workers/subdomain" | jq -r '.result.subdomain // empty')"
if [ -z "$WORKERS_SUB" ]; then
  echo "This Cloudflare account has no workers.dev subdomain yet." >&2
  echo "Open the Cloudflare dashboard > Workers & Pages once (it asks you to choose a subdomain), then run this workflow again." >&2
  exit 1
fi
# worker name of the environment ([env.<name>] name = "...")
WORKER_NAME="$(awk -v sec="[env.$ENV_NAME]" '$0 == sec {f = 1; next} f && /^name *=/ {gsub(/^name *= *"|"$/, ""); print; exit}' "$WRANGLER_TOML")"
[ -n "$WORKER_NAME" ] || { echo "no worker name for env.$ENV_NAME in wrangler.toml" >&2; exit 1; }

{
  echo "d1_id=$D1_ID"
  echo "api_url=https://$WORKER_NAME.$WORKERS_SUB.workers.dev"
  echo "web_url=https://$WEB_HOST"
  echo "admin_url=https://$ADMIN_HOST"
  echo "web_project=$WEB_PROJECT"
  echo "admin_project=$ADMIN_PROJECT"
} >>"$OUT"
