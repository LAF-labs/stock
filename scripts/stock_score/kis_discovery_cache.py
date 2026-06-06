from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from .formatting import as_float
from .io_utils import one_byte_file_lock
from .symbols import clean_ticker


KIS_DISCOVERY_CACHE_VERSION = 1
KIS_DISCOVERY_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30


def kis_discovery_cache_path() -> Path:
    return Path.cwd() / ".kis_discovery_cache.json"


def read_kis_discovery_cache(symbol: str) -> dict[str, Any] | None:
    path = kis_discovery_cache_path()
    try:
        cache = json.loads(path.read_text(encoding="utf-8"))
        item = cache.get(clean_ticker(symbol)) if isinstance(cache, dict) else None
        if not isinstance(item, dict) or item.get("version") != KIS_DISCOVERY_CACHE_VERSION:
            return None
        fetched_at = as_float(item.get("fetched_at"))
        if not fetched_at or fetched_at + KIS_DISCOVERY_CACHE_TTL_SECONDS <= time.time():
            return None
        market = item.get("market")
        if not isinstance(market, dict) or not market.get("excd") or not market.get("product_type"):
            return None
        return item
    except Exception:
        return None


def write_kis_discovery_cache(symbol: str, market: dict[str, Any], search: dict[str, Any]) -> None:
    path = kis_discovery_cache_path()
    lock_path = path.with_suffix(".lock")
    with one_byte_file_lock(lock_path):
        try:
            cache = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(cache, dict):
                cache = {}
        except Exception:
            cache = {}
        cache[clean_ticker(symbol)] = {
            "version": KIS_DISCOVERY_CACHE_VERSION,
            "fetched_at": time.time(),
            "market": market,
            "search": search,
        }
        try:
            tmp_path = path.with_suffix(".tmp")
            tmp_path.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
            tmp_path.replace(path)
        except Exception:
            pass
