import { NextRequest, NextResponse } from "next/server";
import symbols from "@/data/symbols.generated.json";
import type { SymbolMasterItem, SymbolSearchItem } from "@/lib/symbolTypes";

export const dynamic = "force-dynamic";

const MASTER = symbols as SymbolMasterItem[];
const DEFAULT_SYMBOLS = ["US:KO", "US:NVDA", "US:AAPL", "US:MSFT", "KR:005930", "KR:000660", "KR:035420", "KR:005380"];

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.\-_/()[\],]/g, "");
}

function displayName(item: SymbolMasterItem): string {
  if (item.instrumentType === "ETF" && item.englishName) return item.englishName;
  return item.koreanName || item.englishName || item.ticker;
}

function toSearchItem(item: SymbolMasterItem): SymbolSearchItem {
  const key = `${item.market}:${item.ticker}`;
  return {
    ...item,
    key,
    displayName: displayName(item),
    subtitle: `${item.market === "US" ? "미국" : "국내"} · ${item.exchangeName} · ${item.ticker}`,
  };
}

function rank(item: SymbolMasterItem, rawQuery: string): number {
  const query = normalize(rawQuery);
  const ticker = normalize(item.ticker);
  const korean = normalize(item.koreanName || "");
  const english = normalize(item.englishName || "");
  const display = normalize(displayName(item));

  if (!query) return DEFAULT_SYMBOLS.includes(`${item.market}:${item.ticker}`) ? 0 : 999;
  if (ticker === query) return 0;
  if (korean === query || display === query) return 2;
  if (english === query) return 4;
  if (ticker.startsWith(query)) return 10 + ticker.length;
  if (korean.startsWith(query) || display.startsWith(query)) return 30 + display.length;
  if (english.startsWith(query)) return 45 + english.length;
  if (ticker.includes(query)) return 60 + ticker.indexOf(query);
  if (korean.includes(query) || display.includes(query)) {
    const positions = [korean, display].filter((value) => value.includes(query)).map((value) => value.indexOf(query));
    return 80 + Math.min(...positions);
  }
  if (english.includes(query)) return 100 + english.indexOf(query);
  return 999;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") || "";
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") || 8);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 8, 1), 20);
  const market = request.nextUrl.searchParams.get("market");
  const normalizedQuery = normalize(query);

  const items = MASTER.filter((item) => {
    if (market === "US" || market === "KR") {
      if (item.market !== market) return false;
    }
    if (!normalizedQuery) return DEFAULT_SYMBOLS.includes(`${item.market}:${item.ticker}`);
    return rank(item, query) < 999;
  })
    .map((item) => ({ item, score: rank(item, query) }))
    .sort((a, b) => a.score - b.score || a.item.market.localeCompare(b.item.market) || a.item.ticker.localeCompare(b.item.ticker))
    .slice(0, limit)
    .map(({ item }) => toSearchItem(item));

  return NextResponse.json(
    {
      ok: true,
      query,
      total: items.length,
      items,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    }
  );
}
