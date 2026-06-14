"use client";

import { useEffect, useState } from "react";
import type { SecFilingListItem } from "@/lib/secFilings";

export type StockFilingsState =
  | { status: "idle"; items: SecFilingListItem[]; total: 0; ticker?: string }
  | { status: "loading"; items: SecFilingListItem[]; total: 0; ticker: string }
  | { status: "success"; items: SecFilingListItem[]; total: number; ticker: string }
  | { status: "error"; items: SecFilingListItem[]; total: 0; ticker: string; error?: string };

const IDLE_FILINGS_STATE: StockFilingsState = { status: "idle", items: [], total: 0 };

export async function loadStockFilings(
  ticker: string,
  fetcher: typeof fetch = fetch,
  options: { limit?: number; offset?: number; signal?: AbortSignal } = {}
): Promise<{ ok: true; items: SecFilingListItem[]; total: number } | { ok: false; items: []; total: 0; error: string }> {
  const params = new URLSearchParams({
    ticker,
    limit: String(options.limit ?? 3),
    offset: String(options.offset ?? 0),
  });
  try {
    const response = await fetcher(`/api/stock/filings?${params.toString()}`, {
      cache: "no-store",
      signal: options.signal,
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok || !payload || payload.ok !== true || !Array.isArray(payload.items)) {
      return { ok: false, items: [], total: 0, error: "invalid_filings_payload" };
    }
    return {
      ok: true,
      items: payload.items.filter(isSecFilingListItem),
      total: Number.isFinite(payload.total) ? payload.total : payload.items.length,
    };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return { ok: false, items: [], total: 0, error: "aborted" };
    return { ok: false, items: [], total: 0, error: "filings_request_failed" };
  }
}

export function useStockFilings(ticker: string | undefined, enabled: boolean): StockFilingsState {
  const [state, setState] = useState<StockFilingsState>(IDLE_FILINGS_STATE);

  useEffect(() => {
    if (!ticker || !enabled || !/^(US|KR):/.test(ticker)) {
      setState(IDLE_FILINGS_STATE);
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    setState({ status: "loading", items: [], total: 0, ticker });

    void loadStockFilings(ticker, fetch, { limit: 3, offset: 0, signal: controller.signal }).then((result) => {
      if (!active) return;
      if (result.ok) {
        setState({ status: "success", items: result.items, total: result.total, ticker });
        return;
      }
      setState({ status: "error", items: [], total: 0, ticker, error: result.error });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, ticker]);

  return state.ticker && state.ticker !== ticker ? IDLE_FILINGS_STATE : state;
}

function isSecFilingListItem(value: unknown): value is SecFilingListItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SecFilingListItem>;
  return Boolean(
    item.ticker &&
    item.accessionNumber &&
    item.formType &&
    item.filedAt &&
    item.summaryKo &&
    item.sourceUrl
  );
}
