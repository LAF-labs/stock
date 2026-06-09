from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PACKAGE_PATH = ROOT / "package.json"
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "publish-stock-snapshots.yml"
BENCHMARK_WORKFLOW_PATH = ROOT / ".github" / "workflows" / "maintain-industry-benchmarks.yml"
OPERATIONS_WORKFLOW_PATH = ROOT / ".github" / "workflows" / "stock-operations-check.yml"
CI_WORKFLOW_PATH = ROOT / ".github" / "workflows" / "ci.yml"
VERCEL_PREVIEW_DEPLOY_PATH = ROOT / "scripts" / "vercel_preview_deploy.sh"


class PublishWorkflowTests(unittest.TestCase):
    def test_refresh_queue_worker_runs_on_ten_minute_calendar_guarded_backstop(self):
        text = WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn('- cron: "*/10 * * * *"', text)
        self.assertNotIn('- cron: "*/5 * * * 1-5"', text)
        self.assertNotIn('- cron: "*/30 * * * 0,6"', text)
        self.assertIn("market_guard:", text)
        self.assertIn("node --import tsx scripts/stock_market_open_guard.ts", text)
        self.assertIn("needs: market_guard", text)
        self.assertIn("needs.market_guard.outputs.run == '1'", text)

    def test_refresh_queue_worker_serializes_overlapping_runs(self):
        text = WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn("concurrency:", text)
        self.assertIn("publish-stock-snapshots", text)
        self.assertIn("cancel-in-progress: false", text)

    def test_refresh_queue_worker_keeps_score_job_independent_from_quote_failures(self):
        text = WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn("jobs:\n  market_guard:", text)
        self.assertIn("\n  quote:", text)
        self.assertIn("\n  score:", text)
        score_block = text.split("\n  score:", 1)[1]
        score_header = score_block.split("\n    env:", 1)[0]
        self.assertNotIn("needs: quote", score_block)
        self.assertIn("needs: market_guard", score_header)
        self.assertIn("if: always()", score_header)
        self.assertNotIn("needs.market_guard.outputs.run == '1'", score_header)
        self.assertIn("Check due legacy score refresh jobs", score_block)
        self.assertIn("Drain legacy score refresh queue", score_block)

    def test_refresh_queue_worker_uses_typescript_quote_worker_and_isolates_legacy_score(self):
        text = WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn("actions/setup-node@v4", text)
        self.assertIn("npm ci", text)
        self.assertIn("node --import tsx scripts/publish_stock_snapshots.ts", text)
        self.assertIn("--kind quote", text)
        self.assertIn("github-quote-${{ github.run_id }}-${{ github.run_attempt }}", text)
        self.assertIn("STOCK_LEGACY_SCORE_WORKER_ENABLED", text)
        self.assertIn("node --import tsx scripts/stock_refresh_queue_status.ts", text)
        self.assertIn("FORCE_TICKERS=\"${MANUAL_WARM_TICKERS:-}\"", text)
        self.assertIn("needs.market_guard.outputs.run", text)
        self.assertIn("--force-if-list \"$FORCE_TICKERS\"", text)
        self.assertIn("steps.legacy_score_queue.outputs.run == '1'", text)
        self.assertIn("--queue-kind score", text)
        self.assertIn("--views \"$STOCK_SCORE_WARM_VIEWS\"", text)
        self.assertIn("github-score-${{ github.run_id }}-${{ github.run_attempt }}", text)
        self.assertIn("STOCK_WARM_BATCH_SIZE", text)
        self.assertIn("STOCK_WARM_POOL_LIMIT", text)
        self.assertIn("STOCK_WARM_FROM_DEMAND", text)
        self.assertIn("--warm-batch-size", text)
        self.assertIn("--warm-pool-limit", text)

    def test_industry_benchmark_worker_runs_once_after_us_aftermarket(self):
        text = BENCHMARK_WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn('- cron: "30 1 * * 2-6"', text)
        self.assertIn("sync_external_industry_benchmarks.py", text)
        self.assertIn("sync_market_calendar.py --days 550", text)
        self.assertIn("run_industry_maintenance.py --refresh-benchmarks", text)
        self.assertIn("industry_quality_audit.py --json", text)
        self.assertIn("SUPABASE_PUBLISHABLE_KEY", text)
        self.assertIn("supabase_runtime_readiness.py --json", text)
        self.assertLess(text.index("run_industry_maintenance.py --refresh-benchmarks"), text.index("sync_external_industry_benchmarks.py"))
        self.assertIn("continue-on-error: true", text)

    def test_operations_check_runs_on_schedule_with_thresholds(self):
        text = OPERATIONS_WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn('cron: "*/15 * * * 1-5"', text)
        self.assertIn('cron: "0 */3 * * 0,6"', text)
        self.assertIn("workflow_dispatch:", text)
        self.assertIn("actions/setup-node@v4", text)
        self.assertIn("npm ci", text)
        self.assertIn("node --import tsx scripts/stock_operations_report.ts", text)
        self.assertNotIn("actions/setup-python", text)
        self.assertNotIn("stock_operations_report.py", text)
        self.assertIn("--fail-on-threshold", text)
        self.assertIn("--max-dead-refresh-jobs 0", text)
        self.assertIn("--min-current-score-model-rate", text)
        self.assertIn("STOCK_OPS_MAX_QUEUED_REFRESH_JOBS", text)
        self.assertIn("MARKET_DATA_SERVICE_URL", text)
        self.assertIn("MARKET_DATA_INTERNAL_TOKEN", text)
        self.assertIn("--max-market-data-service-failures 0", text)
        self.assertIn("Run production latency smoke", text)
        self.assertIn("node scripts/load_test_stock_latency.mjs", text)
        self.assertIn("--warmup-iterations", text)
        self.assertIn("--max-p95-ms", text)
        self.assertIn("STOCK_LATENCY_BASE_URL", text)

    def test_workflows_opt_into_node24_actions_runtime(self):
        for path in [
            CI_WORKFLOW_PATH,
            WORKFLOW_PATH,
            BENCHMARK_WORKFLOW_PATH,
            OPERATIONS_WORKFLOW_PATH,
        ]:
            with self.subTest(path=path.name):
                text = path.read_text(encoding="utf-8")
                self.assertIn('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"', text)

    def test_package_ops_check_uses_market_data_threshold(self):
        text = PACKAGE_PATH.read_text(encoding="utf-8")

        self.assertIn("--max-market-data-service-failures 0", text)

    def test_stock_operations_report_does_not_hide_old_refresh_jobs(self):
        text = (ROOT / "supabase" / "migrations" / "20260606170000_stock_operations_report_full_queue.sql").read_text(encoding="utf-8")

        self.assertIn("create or replace function public.stock_operations_report", text)
        self.assertNotIn("created_at >= now() - interval '14 days'", text)

    def test_ci_builds_and_smokes_market_data_container(self):
        text = CI_WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn("Market-data container smoke", text)
        self.assertIn("docker build --target market-data", text)
        self.assertIn("/healthz", text)
        self.assertIn("/metrics", text)
        self.assertIn("MARKET_DATA_INTERNAL_TOKEN", text)

    def test_manual_vercel_preview_deploy_uses_node_readiness(self):
        text = VERCEL_PREVIEW_DEPLOY_PATH.read_text(encoding="utf-8")

        self.assertIn("npm run supabase:readiness", text)
        self.assertNotIn("supabase_runtime_readiness.py", text)
        self.assertNotIn("PYTHON_CMD", text)


if __name__ == "__main__":
    unittest.main()
