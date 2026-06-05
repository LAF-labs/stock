#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

BRANCH="$(git branch --show-current)"
COMMIT_SHA="$(git rev-parse HEAD)"
ENV_FILE="${TMPDIR:-/tmp}/stock-vercel-preview-${BRANCH//\//-}.env"
LOCAL_DEPLOY_ENV="$ROOT_DIR/.env.vercel.local"
DEPLOY_DIR="${TMPDIR:-/tmp}/stock-vercel-manual-preview"

if [[ -z "$BRANCH" ]]; then
  echo "Unable to detect current git branch." >&2
  exit 1
fi

echo "Pulling Vercel preview env for branch: $BRANCH"
npx vercel env pull "$ENV_FILE" --environment=preview --git-branch "$BRANCH" >/dev/null

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
# shellcheck disable=SC1091
source "$ROOT_DIR/.env.local"
if [[ -f "$LOCAL_DEPLOY_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$LOCAL_DEPLOY_ENV"
fi
set +a

export STOCK_DATA_RUNTIME="${STOCK_DATA_RUNTIME:-snapshot}"
export STOCK_API_APP_KEY="${STOCK_API_APP_KEY:-${KIS_APP_KEY:-}}"
export STOCK_API_APP_SECRET="${STOCK_API_APP_SECRET:-${KIS_APP_SECRET:-}}"
export STOCK_API_BASE="${STOCK_API_BASE:-${KIS_API_BASE:-https://openapi.koreainvestment.com:9443}}"

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  if [[ -f "$ROOT_DIR/.env.supabase.local" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env.supabase.local"
    set +a
  fi
  SUPABASE_PROJECT_REF="$(cat "$ROOT_DIR/supabase/.temp/project-ref")"
  export SUPABASE_SERVICE_ROLE_KEY="$(
    supabase projects api-keys --project-ref "$SUPABASE_PROJECT_REF" -o json \
      | jq -r '.[] | select(.name=="service_role") | .api_key'
  )"
fi

ensure_secret() {
  local name="$1"
  if [[ -n "${!name:-}" ]]; then
    return
  fi

  local value
  value="$(openssl rand -hex 32)"
  printf '%s=%s\n' "$name" "$value" >> "$LOCAL_DEPLOY_ENV"
  export "$name=$value"
}

ensure_secret STOCK_REFRESH_COOKIE_SECRET
ensure_secret STOCK_RATE_LIMIT_SECRET

required_env=(
  STOCK_DATA_RUNTIME
  SUPABASE_URL
  SUPABASE_PUBLISHABLE_KEY
  SUPABASE_SERVICE_ROLE_KEY
  STOCK_REFRESH_COOKIE_SECRET
  STOCK_RATE_LIMIT_SECRET
  STOCK_API_APP_KEY
  STOCK_API_APP_SECRET
  STOCK_API_BASE
)

missing=()
for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done

if (( ${#missing[@]} )); then
  printf 'Missing Vercel preview env for branch %s:\n' "$BRANCH" >&2
  printf ' - %s\n' "${missing[@]}" >&2
  exit 2
fi

rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR/.vercel"
git archive HEAD | tar -x -C "$DEPLOY_DIR"
cp .vercel/project.json "$DEPLOY_DIR/.vercel/project.json"

env_args=()
for name in "${required_env[@]}"; do
  env_args+=("-e" "${name}=${!name}")
done

echo "Deploying Vercel preview from commit $COMMIT_SHA"
npx vercel deploy "$DEPLOY_DIR" \
  --target=preview \
  --archive=tgz \
  --yes \
  -m githubDeployment=1 \
  -m githubCommitOrg=LAF-labs \
  -m githubCommitRepo=stock \
  -m githubCommitRef="$BRANCH" \
  -m githubCommitSha="$COMMIT_SHA" \
  "${env_args[@]}"
