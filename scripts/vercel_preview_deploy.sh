#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

BRANCH="$(git branch --show-current)"
COMMIT_SHA="$(git rev-parse HEAD)"
ENV_FILE="${TMPDIR:-/tmp}/stock-vercel-preview-${BRANCH//\//-}.env"

if [[ -z "$BRANCH" ]]; then
  echo "Unable to detect current git branch." >&2
  exit 1
fi

echo "Pulling Vercel preview env for branch: $BRANCH"
npx vercel env pull "$ENV_FILE" --environment=preview --git-branch "$BRANCH" >/dev/null

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
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
  if ! grep -q "^${name}=" "$ENV_FILE"; then
    missing+=("$name")
  fi
done

if (( ${#missing[@]} )); then
  printf 'Missing Vercel preview env for branch %s:\n' "$BRANCH" >&2
  printf ' - %s\n' "${missing[@]}" >&2
  exit 2
fi

echo "Deploying Vercel preview from commit $COMMIT_SHA"
npx vercel deploy "$ROOT_DIR" \
  --target=preview \
  --archive=tgz \
  --yes \
  -m githubDeployment=1 \
  -m githubCommitOrg=LAF-labs \
  -m githubCommitRepo=stock \
  -m githubCommitRef="$BRANCH" \
  -m githubCommitSha="$COMMIT_SHA"
