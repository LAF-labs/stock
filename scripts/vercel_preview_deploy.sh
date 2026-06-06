#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

BRANCH="$(git branch --show-current)"
COMMIT_SHA="$(git rev-parse HEAD)"
ENV_LIST_FILE="${TMPDIR:-/tmp}/stock-vercel-preview-${BRANCH//\//-}.env-list.json"
DEPLOY_DIR="${TMPDIR:-/tmp}/stock-vercel-manual-preview"
umask 077

cleanup() {
  rm -f "$ENV_LIST_FILE"
}
trap cleanup EXIT

if [[ -z "$BRANCH" ]]; then
  echo "Unable to detect current git branch." >&2
  exit 1
fi

echo "Checking Vercel global preview env names"
npx vercel env list preview --format json > "$ENV_LIST_FILE"

required_vercel_env=(
  SUPABASE_URL
  SUPABASE_PUBLISHABLE_KEY
  SUPABASE_SERVICE_ROLE_KEY
  STOCK_REFRESH_COOKIE_SECRET
  STOCK_RATE_LIMIT_SECRET
  STOCK_API_APP_KEY
  STOCK_API_APP_SECRET
)

missing="$(
  node - "$ENV_LIST_FILE" "${required_vercel_env[@]}" <<'NODE'
const fs = require("node:fs");

const file = process.argv[2];
const required = process.argv.slice(3);
const payload = JSON.parse(fs.readFileSync(file, "utf8"));
const rows = Array.isArray(payload) ? payload : payload.envs || payload.environmentVariables || payload.items || [];
const globalPreviewRows = rows.filter((row) => row && !row.gitBranch);
const names = new Set(globalPreviewRows.map((row) => row && (row.key || row.name)).filter(Boolean));

for (const name of required) {
  if (!names.has(name)) {
    console.log(name);
  }
}
NODE
)"

if [[ -n "$missing" ]]; then
  printf 'Missing Vercel global preview env for manual deployments:\n' >&2
  while IFS= read -r name; do
    [[ -n "$name" ]] && printf ' - %s\n' "$name" >&2
  done <<< "$missing"
  printf 'Add these to all Preview branches first. Manual archive deploys do not receive branch-specific preview envs.\n' >&2
  exit 2
fi

export STOCK_DATA_RUNTIME="${STOCK_DATA_RUNTIME:-snapshot}"
export STOCK_API_APP_KEY="${STOCK_API_APP_KEY:-${KIS_APP_KEY:-}}"
export STOCK_API_APP_SECRET="${STOCK_API_APP_SECRET:-${KIS_APP_SECRET:-}}"
export STOCK_API_BASE="${STOCK_API_BASE:-${KIS_API_BASE:-https://openapi.koreainvestment.com:9443}}"

npm run supabase:readiness

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
