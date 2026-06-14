"use client";

import { useEffect, useState } from "react";
import { loadStockNews } from "@/lib/clientStockNews";
import type { NewsItem } from "@/lib/types";

type StockNewsState =
  | { status: "idle"; items: NewsItem[]; ticker?: string }
  | { status: "loading"; items: NewsItem[]; ticker: string }
  | { status: "success"; items: NewsItem[]; ticker: string }
  | { status: "error"; items: NewsItem[]; ticker: string; error?: string };

const IDLE_NEWS_STATE: StockNewsState = { status: "idle", items: [] };

export function useStockNews(ticker: string | undefined, enabled: boolean): StockNewsState {
  const [state, setState] = useState<StockNewsState>(IDLE_NEWS_STATE);

  useEffect(() => {
    if (!ticker || !enabled) {
      setState(IDLE_NEWS_STATE);
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    setState({ status: "loading", items: [], ticker });

    void loadStockNews(ticker, fetch, { signal: controller.signal }).then((result) => {
      if (!active) return;
      if (result.ok) {
        setState({ status: "success", items: result.items, ticker });
        return;
      }
      setState({ status: "error", items: [], ticker, error: result.error });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, ticker]);

  return state.ticker && state.ticker !== ticker ? IDLE_NEWS_STATE : state;
}
