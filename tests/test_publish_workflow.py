from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "publish-stock-snapshots.yml"


class PublishWorkflowTests(unittest.TestCase):
    def test_refresh_queue_worker_runs_on_five_minute_backstop(self):
        text = WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn('- cron: "*/5 * * * 1-5"', text)
        self.assertNotIn('- cron: "*/30 * * * 1-5"', text)

    def test_refresh_queue_worker_serializes_overlapping_runs(self):
        text = WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn("concurrency:", text)
        self.assertIn("publish-stock-snapshots", text)
        self.assertIn("cancel-in-progress: false", text)


if __name__ == "__main__":
    unittest.main()
