import type { NewsItem } from "@/lib/types";

export type NaverNewsEnv = Record<string, string | undefined>;
export type NaverNewsFetch = typeof fetch;

export type NaverNewsSearchResult =
  | { ok: true; items: NewsItem[] }
  | { ok: false; error: string; message: string; items: NewsItem[]; status?: number };

export type FetchNaverStockNewsInput = {
  ticker: string;
  queryName?: string;
  env?: NaverNewsEnv;
  fetcher?: NaverNewsFetch;
  timeoutMs?: number;
};

type NaverNewsApiItem = {
  title?: unknown;
  link?: unknown;
  pubDate?: unknown;
};

type NaverNewsApiPayload = {
  items?: unknown;
};

const NAVER_NEWS_ENDPOINT = "https://openapi.naver.com/v1/search/news.json";
const DEFAULT_DISPLAY_COUNT = 8;
const DEFAULT_TIMEOUT_MS = 1_500;

export function naverNewsConfigured(env: NaverNewsEnv = process.env): boolean {
  return Boolean(naverClientId(env) && naverClientSecret(env));
}

export async function fetchNaverStockNews(input: FetchNaverStockNewsInput): Promise<NaverNewsSearchResult> {
  const env = input.env ?? process.env;
  const clientId = naverClientId(env);
  const clientSecret = naverClientSecret(env);
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      error: "naver_news_not_configured",
      message: "Naver news search credentials are not configured.",
      items: [],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  unrefTimer(timeout);

  try {
    const response = await (input.fetcher ?? fetch)(naverNewsUrl(input), {
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        error: response.status === 429 ? "naver_news_rate_limited" : "naver_news_fetch_failed",
        message: "Naver news search request failed.",
        status: response.status,
        items: [],
      };
    }

    const payload = await response.json().catch(() => undefined) as NaverNewsApiPayload | undefined;
    return {
      ok: true,
      items: normalizeNaverNewsItems(payload?.items),
    };
  } catch {
    return {
      ok: false,
      error: "naver_news_unavailable",
      message: "Naver news search is unavailable.",
      items: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

function naverNewsUrl(input: Pick<FetchNaverStockNewsInput, "ticker" | "queryName">): string {
  const url = new URL(NAVER_NEWS_ENDPOINT);
  url.searchParams.set("query", naverNewsQuery(input.ticker, input.queryName));
  url.searchParams.set("display", String(DEFAULT_DISPLAY_COUNT));
  url.searchParams.set("start", "1");
  url.searchParams.set("sort", "date");
  return url.toString();
}

function naverNewsQuery(ticker: string, queryName: string | undefined): string {
  const symbol = ticker.replace(/^(KR|US):/i, "").trim();
  const name = queryName?.trim();
  const market = ticker.toUpperCase().startsWith("KR:") ? "주식" : "stock";
  return [name, symbol, market].filter(Boolean).join(" ");
}

function normalizeNaverNewsItems(value: unknown): NewsItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeNaverNewsItem(item))
    .filter((item): item is NewsItem => Boolean(item));
}

function normalizeNaverNewsItem(value: unknown): NewsItem | undefined {
  if (!isRecord(value)) return undefined;
  const item = value as NaverNewsApiItem;
  const title = stringValue(item.title);
  const link = stringValue(item.link);
  if (!title || !isHttpUrl(link)) return undefined;
  return {
    title,
    publisher: "NAVER 뉴스",
    link,
    provider_publish_time: epochSeconds(item.pubDate),
  };
}

function naverClientId(env: NaverNewsEnv): string | undefined {
  return stringValue(env.NAVER_SEARCH_CLIENT_ID) || stringValue(env.NAVER_CLIENT_ID);
}

function naverClientSecret(env: NaverNewsEnv): string | undefined {
  return stringValue(env.NAVER_SEARCH_CLIENT_SECRET) || stringValue(env.NAVER_CLIENT_SECRET);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function epochSeconds(value: unknown): number | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function unrefTimer(timeout: ReturnType<typeof setTimeout>) {
  if (typeof timeout === "object" && timeout && "unref" in timeout && typeof timeout.unref === "function") {
    timeout.unref();
  }
}
