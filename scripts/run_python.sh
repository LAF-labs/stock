#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${PYTHON_BIN:-}" ]]; then
  exec "$PYTHON_BIN" "$@"
fi

if [[ -x ".venv/bin/python" ]]; then
  exec ".venv/bin/python" "$@"
fi

exec python3 "$@"
