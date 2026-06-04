#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

python3 demo_app.py --host 127.0.0.1 --port 8891 --open
