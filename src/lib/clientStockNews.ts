import type { NewsItem } from "@/lib/types";

export type StockNewsClientFetch = typeof fetch;

export type StockNewsClientResult = {
  ok: boolean;
  items: NewsItem[];
  error?: string;
  message?: string;
};

export async function loadStockNews(
  ticker: string,
  fetcher: StockNewsClientFetch = fetch,
  options: { signal?: AbortSignal } = {},
): Promise<StockNewsClientResult> {
  try {
    const response = await fetcher(`/api/stock/news?${new URLSearchParams({ ticker }).toString()}`, {
      cache: "no-store",
      signal: options.signal,
    });
    const payload = await response.json().catch(() => undefined);
    return normalizeStockNewsPayload(payload);
  } catch {
    return {
      ok: false,
      items: [],
      error: "stock_news_unavailable",
      message: "Stock news is unavailable.",
    };
  }
}

function normalizeStockNewsPayload(value: unknown): StockNewsClientResult {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return {
      ok: false,
      items: [],
      error: "invalid_stock_news_payload",
      message: "Stock news response is invalid.",
    };
  }
  return {
    ok: value.ok === true,
    items: value.items.filter(isNewsItem),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  };
}

function isNewsItem(value: unknown): value is NewsItem {
  return isRecord(value) && typeof value.title === "string" && typeof value.link === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
