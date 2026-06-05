#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parents[1]


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        if key and key not in os.environ:
            os.environ[key] = value


def readiness_payload(url: str, key: str, timeout: float) -> dict:
    endpoint = f"{url.rstrip('/')}/rest/v1/rpc/stock_runtime_readiness"
    try:
        response = requests.post(
            endpoint,
            json={},
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=timeout,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"Supabase readiness RPC is unreachable: {exc}") from exc
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase readiness RPC failed with HTTP {response.status_code}: {response.text[:500]}")

    payload = response.json() if response.text else {}
    if not isinstance(payload, dict):
        raise RuntimeError("Supabase readiness RPC returned a non-object payload.")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Check Supabase runtime tables and RPCs before deployment.")
    parser.add_argument("--json", action="store_true", help="Print the readiness payload as JSON.")
    parser.add_argument("--timeout", type=float, default=8.0, help="HTTP timeout in seconds.")
    args = parser.parse_args()

    load_env_file(ROOT / ".env.local")
    load_env_file(ROOT / ".env.supabase.local")
    load_env_file(ROOT / ".env.vercel.local")

    url = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for readiness checks.", file=sys.stderr)
        return 2

    try:
        payload = readiness_payload(url, key, args.timeout)
    except Exception as exc:  # noqa: BLE001 - deployment preflight should report one concise failure.
        print(str(exc), file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))

    if payload.get("ok") is not True:
        missing_tables = ", ".join(payload.get("missing_tables") or [])
        missing_rpcs = ", ".join(payload.get("missing_rpcs") or [])
        print(f"Supabase runtime readiness failed. missing_tables=[{missing_tables}] missing_rpcs=[{missing_rpcs}]", file=sys.stderr)
        return 1

    if not args.json:
        print("Supabase runtime readiness OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
