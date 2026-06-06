import unittest
from types import SimpleNamespace

from scripts.score_smoke_check import DEFAULT_TICKERS, parse_tickers


class ScoreSmokeCheckTests(unittest.TestCase):
    def test_default_smoke_tickers_use_marvell_common_stock(self):
        self.assertIn("MRVL", DEFAULT_TICKERS)
        self.assertNotIn("MVRL", DEFAULT_TICKERS)
        self.assertEqual(parse_tickers(SimpleNamespace(ticker=None, tickers=None)), DEFAULT_TICKERS)


if __name__ == "__main__":
    unittest.main()
