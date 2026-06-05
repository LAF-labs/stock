#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_READ_CHECKS = (
    ("stock_score_snapshots", "ticker"),
    ("stock_quote_snapshots", "ticker"),
    ("stock_fundamental_snapshots", "market"),
    ("market_calendar", "market"),
    ("stock_industry_benchmarks", "metric"),
    ("stock_symbol_profiles", "market"),
    ("stock_symbol_industry_tags", "market"),
    ("industry_taxonomy_map", "taxonomy"),
    ("stock_rule_judgments", "ticker"),
    ("stock_ai_judgments", "ticker"),
)


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


def public_read_payload(url: str, key: str, timeout: float) -> dict:
    failures: list[dict[str, object]] = []
    for table, column in PUBLIC_READ_CHECKS:
        endpoint = f"{url.rstrip('/')}/rest/v1/{table}"
        try:
            response = requests.get(
                endpoint,
                params={"select": column, "limit": "1"},
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "Accept": "application/json",
                },
                timeout=timeout,
            )
        except requests.RequestException as exc:
            failures.append({"table": table, "error": str(exc)})
            continue
        if response.status_code >= 400:
            failures.append({"table": table, "status": response.status_code, "message": response.text[:300]})
    return {"ok": not failures, "failures": failures}


def main() -> int:
    parser = argparse.ArgumentParser(description="Check Supabase runtime tables and RPCs before deployment.")
    parser.add_argument("--json", action="store_true", help="Print the readiness payload as JSON.")
    parser.add_argument("--timeout", type=float, default=8.0, help="HTTP timeout in seconds.")
    args = parser.parse_args()

    load_env_file(ROOT / ".env.local")
    load_env_file(ROOT / ".env.supabase.local")
    load_env_file(ROOT / ".env.vercel.local")

    url = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    service_role_key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    publishable_key = (os.environ.get("SUPABASE_PUBLISHABLE_KEY") or "").strip()
    if not url or not service_role_key or not publishable_key:
        print("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_PUBLISHABLE_KEY are required for readiness checks.", file=sys.stderr)
        return 2

    try:
        payload = readiness_payload(url, service_role_key, args.timeout)
        payload["public_read"] = public_read_payload(url, publishable_key, args.timeout)
    except Exception as exc:  # noqa: BLE001 - deployment preflight should report one concise failure.
        print(str(exc), file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))

    if payload.get("ok") is not True or payload.get("public_read", {}).get("ok") is not True:
        missing_tables = ", ".join(payload.get("missing_tables") or [])
        missing_rpcs = ", ".join(payload.get("missing_rpcs") or [])
        public_failures = ", ".join(failure.get("table", "?") for failure in payload.get("public_read", {}).get("failures") or [])
        print(
            f"Supabase runtime readiness failed. missing_tables=[{missing_tables}] missing_rpcs=[{missing_rpcs}] public_read_failures=[{public_failures}]",
            file=sys.stderr,
        )
        return 1

    if not args.json:
        print("Supabase runtime readiness OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
