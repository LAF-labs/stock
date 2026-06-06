from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "publish-stock-snapshots.yml"
BENCHMARK_WORKFLOW_PATH = ROOT / ".github" / "workflows" / "maintain-industry-benchmarks.yml"
OPERATIONS_WORKFLOW_PATH = ROOT / ".github" / "workflows" / "stock-operations-check.yml"


class PublishWorkflowTests(unittest.TestCase):
    def test_refresh_queue_worker_runs_on_five_minute_backstop(self):
        text = WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn('- cron: "*/5 * * * 1-5"', text)
        self.assertIn('- cron: "*/30 * * * 0,6"', text)
        self.assertNotIn('- cron: "*/30 * * * 1-5"', text)

    def test_refresh_queue_worker_serializes_overlapping_runs(self):
        text = WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn("concurrency:", text)
        self.assertIn("publish-stock-snapshots", text)
        self.assertIn("cancel-in-progress: false", text)

    def test_refresh_queue_worker_uses_typescript_quote_worker_and_isolates_legacy_score(self):
        text = WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn("actions/setup-node@v4", text)
        self.assertIn("npm ci", text)
        self.assertIn("node --import tsx scripts/publish_stock_snapshots.ts", text)
        self.assertIn("--kind quote", text)
        self.assertIn("github-quote-${{ github.run_id }}-${{ github.run_attempt }}", text)
        self.assertIn("STOCK_LEGACY_SCORE_WORKER_ENABLED", text)
        self.assertIn("node --import tsx scripts/stock_refresh_queue_status.ts", text)
        self.assertIn("--force-if-list \"$MANUAL_WARM_TICKERS\"", text)
        self.assertIn("steps.legacy_score_queue.outputs.run == '1'", text)
        self.assertIn("--queue-kind score", text)
        self.assertIn("--skip-quote", text)
        self.assertIn("github-score-${{ github.run_id }}-${{ github.run_attempt }}", text)

    def test_industry_benchmark_worker_runs_once_after_us_aftermarket(self):
        text = BENCHMARK_WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn('- cron: "30 1 * * 2-6"', text)
        self.assertIn("sync_external_industry_benchmarks.py", text)
        self.assertIn("sync_market_calendar.py --days 550", text)
        self.assertIn("run_industry_maintenance.py --refresh-benchmarks", text)
        self.assertIn("industry_quality_audit.py --json", text)
        self.assertIn("supabase_runtime_readiness.py --json", text)

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


if __name__ == "__main__":
    unittest.main()
