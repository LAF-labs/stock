#!/usr/bin/env bash
set -euo pipefail

image="${1:-stock-market-data:latest}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
docker_config="$(mktemp -d)"

cleanup() {
  rm -rf "$docker_config"
}
trap cleanup EXIT

printf '{"auths":{}}\n' > "$docker_config/config.json"
export DOCKER_CONFIG="$docker_config"
export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-0}"

if [ -S "$HOME/.colima/default/docker.sock" ]; then
  export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
fi

docker build --target market-data -t "$image" "$repo_root"
