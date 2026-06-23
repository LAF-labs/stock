import unittest
from pathlib import Path

import scripts.supabase_runtime_readiness as readiness

ROOT = Path(__file__).resolve().parents[1]


class SupabaseRuntimeReadinessTests(unittest.TestCase):
    def test_readiness_contract_requires_kis_token_cache_checks(self):
        payload = {
            "required_tables": list(readiness.RUNTIME_TABLE_CHECKS),
            "required_rpcs": list(readiness.RUNTIME_RPC_CHECKS),
        }
        self.assertEqual(
            readiness.readiness_contract_payload(payload),
            {
                "ok": True,
                "missing_tables": [],
                "missing_rpcs": [],
                "missing_rpc_signatures": [],
                "missing_rpc_grants": [],
            },
        )

        signature_payload = {
            "required_tables": list(readiness.RUNTIME_TABLE_CHECKS),
            "required_rpcs": list(readiness.RUNTIME_RPC_CHECKS),
            "required_rpc_signatures": [
                {"name": "claim_stock_refresh_jobs", "identity_arguments": "p_worker_id text, p_limit integer, p_lock_seconds integer"}
            ],
            "missing_rpc_grants": ["claim_stock_refresh_jobs_by_kind(text,text,integer,integer)"],
        }
        signature_contract = readiness.readiness_contract_payload(signature_payload)
        self.assertEqual(signature_contract["ok"], False)
        self.assertIn("claim_stock_refresh_jobs_by_kind", "\n".join(signature_contract["missing_rpc_signatures"]))
        self.assertEqual(signature_contract["missing_rpc_grants"], ["claim_stock_refresh_jobs_by_kind(text,text,integer,integer)"])

        stale_payload = {
            "required_tables": [table for table in readiness.RUNTIME_TABLE_CHECKS if table != "public.kis_access_tokens"],
            "required_rpcs": [rpc for rpc in readiness.RUNTIME_RPC_CHECKS if rpc != "acquire_kis_token_issue_lock"],
        }
        contract = readiness.readiness_contract_payload(stale_payload)

        self.assertEqual(contract["ok"], False)
        self.assertEqual(contract["missing_tables"], ["public.kis_access_tokens"])
        self.assertEqual(contract["missing_rpcs"], ["acquire_kis_token_issue_lock"])

    def test_public_read_payload_reports_permission_failures(self):
        calls = []

        class FakeResponse:
            def __init__(self, status_code, text):
                self.status_code = status_code
                self.text = text

        def fake_get(url, params=None, headers=None, timeout=None):
            calls.append({"url": url, "params": params, "headers": headers, "timeout": timeout})
            if url.endswith("/stock_score_snapshots"):
                return FakeResponse(401, '{"message":"permission denied"}')
            return FakeResponse(200, "[]")

        original_get = readiness.requests.get
        readiness.requests.get = fake_get
        try:
            payload = readiness.public_read_payload("https://example.supabase.co", "publishable-key", 3.5)
        finally:
            readiness.requests.get = original_get

        self.assertEqual(payload["ok"], False)
        self.assertEqual(payload["failures"][0]["table"], "stock_score_snapshots")
        self.assertEqual(payload["failures"][0]["status"], 401)
        self.assertEqual(calls[0]["params"], {"select": "ticker", "limit": "1"})
        self.assertIn("publishable-key", calls[0]["headers"]["Authorization"])
        self.assertEqual(calls[0]["timeout"], 3.5)

    def test_public_read_payload_passes_when_all_tables_are_selectable(self):
        class FakeResponse:
            status_code = 200
            text = "[]"

        original_get = readiness.requests.get
        readiness.requests.get = lambda *args, **kwargs: FakeResponse()
        try:
            payload = readiness.public_read_payload("https://example.supabase.co", "publishable-key", 3.5)
        finally:
            readiness.requests.get = original_get

        self.assertEqual(payload, {"ok": True, "failures": []})

    def test_chart_refresh_leases_are_allowed_by_latest_migration(self):
        sql = (ROOT / "supabase" / "migrations" / "20260623091000_allow_chart_refresh_leases.sql").read_text(encoding="utf-8")

        self.assertIn("stock_refresh_leases_kind_check", sql)
        self.assertIn("kind in ('quote', 'score', 'chart', 'fundamentals', 'judgment')", sql)
        self.assertIn("normalized_kind not in ('quote', 'score', 'chart', 'fundamentals', 'judgment')", sql)
        self.assertIn("if normalized_kind <> 'score' then", sql)


if __name__ == "__main__":
    unittest.main()
