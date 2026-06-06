import unittest

import scripts.supabase_runtime_readiness as readiness


class SupabaseRuntimeReadinessTests(unittest.TestCase):
    def test_readiness_contract_requires_kis_token_cache_checks(self):
        payload = {
            "required_tables": list(readiness.RUNTIME_TABLE_CHECKS),
            "required_rpcs": list(readiness.RUNTIME_RPC_CHECKS),
        }
        self.assertEqual(readiness.readiness_contract_payload(payload), {"ok": True, "missing_tables": [], "missing_rpcs": []})

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


if __name__ == "__main__":
    unittest.main()
