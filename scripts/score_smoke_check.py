from __future__ import annotations

import argparse
import json
import math
import sys
from typing import Any

from fetch_yfinance_score import SCORE_MODEL_VERSION, fetch_score


DEFAULT_TICKERS = ["NVDA", "TSLA", "IONQ", "MVRL", "005930", "000660", "253590"]


def component_score(result: dict[str, Any], key: str) -> float | None:
    for component in result.get("components") or []:
        if isinstance(component, dict) and component.get("key") == key:
            score = component.get("score")
            if isinstance(score, (int, float)) and not isinstance(score, bool) and math.isfinite(float(score)):
                return float(score)
    return None


def score_confidence(result: dict[str, Any]) -> float | None:
    snapshot = result.get("sia_snapshot")
    if not isinstance(snapshot, dict):
        return None
    confidence = snapshot.get("confidence")
    if isinstance(confidence, (int, float)) and not isinstance(confidence, bool) and math.isfinite(float(confidence)):
        return float(confidence)
    return None


def score_model_version(result: dict[str, Any]) -> str | None:
    version = result.get("score_model_version")
    if isinstance(version, str) and version.strip():
        return version.strip()
    snapshot = result.get("sia_snapshot")
    if isinstance(snapshot, dict):
        nested = snapshot.get("score_model_version")
        if isinstance(nested, str) and nested.strip():
            return nested.strip()
    return None


def validate_result(ticker: str, result: dict[str, Any], nvda_min_score: float) -> list[str]:
    issues: list[str] = []
    if result.get("ok") is not True:
        issues.append(f"{ticker}: fetch failed ({result.get('error') or result.get('status') or 'unknown_error'})")
        return issues

    score = result.get("score")
    if not isinstance(score, (int, float)) or isinstance(score, bool) or not math.isfinite(float(score)):
        issues.append(f"{ticker}: score is not finite")
        return issues
    score = float(score)
    if not 0.0 <= score <= 100.0:
        issues.append(f"{ticker}: score {score:.1f} is outside 0..100")

    confidence = score_confidence(result)
    if confidence is None or not 0.0 <= confidence <= 1.0:
        issues.append(f"{ticker}: confidence is missing or outside 0..1")
    elif confidence < 0.5 and score > 60.0:
        issues.append(f"{ticker}: low-confidence score should stay conservative, got score {score:.1f} / confidence {confidence:.3f}")

    version = score_model_version(result)
    if version != SCORE_MODEL_VERSION:
        issues.append(f"{ticker}: score model version mismatch ({version or 'missing'} != {SCORE_MODEL_VERSION})")

    components = result.get("components")
    if not isinstance(components, list) or len(components) < 5:
        issues.append(f"{ticker}: expected at least 5 score components")

    if ticker.upper() == "NVDA" and score < nvda_min_score:
        issues.append(f"NVDA: premium growth leader guardrail failed ({score:.1f} < {nvda_min_score:.1f})")

    return issues


def summarize_result(ticker: str, result: dict[str, Any]) -> dict[str, Any]:
    return {
        "ticker": ticker,
        "ok": result.get("ok") is True,
        "symbol": result.get("symbol"),
        "score": result.get("score"),
        "grade": (result.get("grade") or {}).get("class") if isinstance(result.get("grade"), dict) else None,
        "confidence": score_confidence(result),
        "score_model_version": score_model_version(result),
        "profitability": component_score(result, "profitability"),
        "growth": component_score(result, "growth"),
        "health": component_score(result, "health"),
        "momentum": component_score(result, "momentum"),
        "valuation": component_score(result, "valuation"),
        "error": result.get("error"),
    }


def parse_tickers(args: argparse.Namespace) -> list[str]:
    tickers: list[str] = []
    for value in args.ticker or []:
        tickers.extend(part.strip().upper() for part in value.split(",") if part.strip())
    if args.tickers:
        tickers.extend(part.strip().upper() for part in args.tickers.split(",") if part.strip())
    return tickers or DEFAULT_TICKERS


def main() -> int:
    parser = argparse.ArgumentParser(description="Run score model guardrail smoke checks against live collector data.")
    parser.add_argument("--ticker", action="append", help="Ticker to check. Can be repeated or comma-separated.")
    parser.add_argument("--tickers", help="Comma-separated ticker list.")
    parser.add_argument("--view", choices=["compare", "detail"], default="compare")
    parser.add_argument("--nvda-min-score", type=float, default=80.0)
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args()

    rows: list[dict[str, Any]] = []
    issues: list[str] = []
    for ticker in parse_tickers(args):
        result = fetch_score(ticker, view=args.view)
        rows.append(summarize_result(ticker, result))
        issues.extend(validate_result(ticker, result, args.nvda_min_score))

    payload = {
        "ok": not issues,
        "score_model_version": SCORE_MODEL_VERSION,
        "view": args.view,
        "rows": rows,
        "issues": issues,
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(f"score_model_version={SCORE_MODEL_VERSION}")
        for row in rows:
            print(
                "{ticker:>8} score={score!s:>5} confidence={confidence!s:>5} "
                "P/G/H/M/V={profitability!s}/{growth!s}/{health!s}/{momentum!s}/{valuation!s}".format(**row)
            )
        if issues:
            print("\nFAILED")
            for issue in issues:
                print(f"- {issue}")
        else:
            print("\nOK")
    return 0 if not issues else 1


if __name__ == "__main__":
    sys.exit(main())
