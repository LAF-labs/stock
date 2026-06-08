from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
POLICY_PATH = ROOT / "shared" / "stock-cache-policy.json"


@lru_cache(maxsize=1)
def _policies() -> dict[str, dict[str, int]]:
    raw = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("Stock cache policy file must contain an object.")
    return raw


def cache_policy_for(key: str) -> dict[str, int]:
    normalized_key = str(key)
    entry: Any = _policies().get(normalized_key)
    if not isinstance(entry, dict):
        raise ValueError(f"Unknown stock cache policy: {normalized_key}")

    fresh = entry.get("fresh_seconds")
    stale = entry.get("stale_seconds")
    if not isinstance(fresh, int) or not isinstance(stale, int) or fresh <= 0 or stale <= 0:
        raise ValueError(f"Unknown stock cache policy: {normalized_key}")
    if fresh > stale:
        raise ValueError(f"Invalid stock cache policy expiry order: {normalized_key}")
    return {"fresh_seconds": fresh, "stale_seconds": stale}


def fresh_seconds(key: str) -> int:
    return cache_policy_for(key)["fresh_seconds"]


def stale_seconds(key: str) -> int:
    return cache_policy_for(key)["stale_seconds"]
