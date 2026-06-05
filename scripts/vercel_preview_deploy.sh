#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

BRANCH="$(git branch --show-current)"
COMMIT_SHA="$(git rev-parse HEAD)"
ENV_FILE="${TMPDIR:-/tmp}/stock-vercel-preview-${BRANCH//\//-}.env"
DEPLOY_DIR="${TMPDIR:-/tmp}/stock-vercel-manual-preview"
umask 077

cleanup() {
  rm -f "$ENV_FILE"
}
trap cleanup EXIT

if [[ -z "$BRANCH" ]]; then
  echo "Unable to detect current git branch." >&2
  exit 1
fi

echo "Pulling Vercel preview env for branch: $BRANCH"
npx vercel env pull "$ENV_FILE" --environment=preview --git-branch "$BRANCH" >/dev/null

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
export STOCK_DATA_RUNTIME="${STOCK_DATA_RUNTIME:-snapshot}"
export STOCK_API_APP_KEY="${STOCK_API_APP_KEY:-${KIS_APP_KEY:-}}"
export STOCK_API_APP_SECRET="${STOCK_API_APP_SECRET:-${KIS_APP_SECRET:-}}"
export STOCK_API_BASE="${STOCK_API_BASE:-${KIS_API_BASE:-https://openapi.koreainvestment.com:9443}}"
set +a

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
  printf 'Add these to Vercel preview env first. Secrets are no longer passed via deploy CLI arguments.\n' >&2
  exit 2
fi

export STOCK_DATA_RUNTIME="${STOCK_DATA_RUNTIME:-snapshot}"
export STOCK_API_APP_KEY="${STOCK_API_APP_KEY:-${KIS_APP_KEY:-}}"
export STOCK_API_APP_SECRET="${STOCK_API_APP_SECRET:-${KIS_APP_SECRET:-}}"
export STOCK_API_BASE="${STOCK_API_BASE:-${KIS_API_BASE:-https://openapi.koreainvestment.com:9443}}"

"${PYTHON_BIN:-python}" scripts/supabase_runtime_readiness.py

rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR/.vercel"
git archive HEAD | tar -x -C "$DEPLOY_DIR"
cp .vercel/project.json "$DEPLOY_DIR/.vercel/project.json"

echo "Deploying Vercel preview from commit $COMMIT_SHA"
npx vercel deploy "$DEPLOY_DIR" \
  --target=preview \
  --archive=tgz \
  --yes \
  -m githubDeployment=1 \
  -m githubCommitOrg=LAF-labs \
  -m githubCommitRepo=stock \
  -m githubCommitRef="$BRANCH" \
  -m githubCommitSha="$COMMIT_SHA"
