import type { DisplayPart, DisplayPartFreshness, StockDisplayPartName, StockDisplayPayload } from "@/lib/stockDisplayTypes";
import type { StockDetailPartName, StockDetailPartStatus, StockDetailViewModel } from "@/lib/stockDetailViewTypes";

const DETAIL_PART_TO_DISPLAY_PARTS: Record<StockDetailPartName, StockDisplayPartName[]> = {
  price: ["price"],
  chart: ["chart"],
  score: ["score"],
  financials: ["fundamentals", "industryBenchmark"],
  analyst: ["judgment", "news"],
};

export function stockDetailViewFromDisplayPayload(payload: StockDisplayPayload): StockDetailViewModel {
  const parts = detailPartStatuses(payload);
  const financials = financialSectionFromDisplayPayload(payload);
  const analyst = analystSectionFromDisplayPayload(payload);
  const hasVisibleNonIdentitySection = Boolean(
    payload.price ||
    payload.chart ||
    payload.score ||
    financials ||
    analyst
  );
  const mode = payload.refresh.active || payload.completion.missingParts.length > 0 || payload.completion.recoveringParts.length > 0 ? "partial" : "ready";

  return {
    ok: true,
    mode,
    ticker: payload.ticker,
    requestedTicker: payload.requestedTicker,
    view: payload.view,
    generatedAt: payload.generatedAt,
    snapshotVersion: payload.snapshotVersion,
    ...(!hasVisibleNonIdentitySection ? { degradedReason: "identity_only" as const } : {}),
    ...(payload.refresh.active ? { nextPollMs: payload.refresh.nextPollMs || 1_500 } : {}),
    identity: payload.identity.value,
    sections: {
      ...(payload.price ? { price: payload.price.value } : {}),
      ...(payload.chart ? { chart: payload.chart.value } : {}),
      ...(payload.score ? { score: payload.score.value } : {}),
      ...(financials ? { financials } : {}),
      ...(analyst ? { analyst } : {}),
    },
    parts,
    jobs: jobsFromParts(parts),
  };
}

function financialSectionFromDisplayPayload(payload: StockDisplayPayload): Record<string, unknown> | undefined {
  return mergeRecords(payload.fundamentals?.value, payload.industryBenchmark?.value);
}

function analystSectionFromDisplayPayload(payload: StockDisplayPayload): Record<string, unknown> | undefined {
  const news = payload.news?.value;
  const normalizedNews = news && Array.isArray(news.items) ? { news: news.items } : news;
  return mergeRecords(payload.judgment?.value, normalizedNews);
}

function detailPartStatuses(payload: StockDisplayPayload): Record<StockDetailPartName, StockDetailPartStatus> {
  return {
    price: detailPartStatus(payload, "price"),
    chart: detailPartStatus(payload, "chart"),
    score: detailPartStatus(payload, "score"),
    financials: detailPartStatus(payload, "financials"),
    analyst: detailPartStatus(payload, "analyst"),
  };
}

function detailPartStatus(payload: StockDisplayPayload, part: StockDetailPartName): StockDetailPartStatus {
  const displayParts = DETAIL_PART_TO_DISPLAY_PARTS[part];
  const present = displayParts.find((displayPart) => payload.completion.presentParts.includes(displayPart));
  const unavailable = payload.completion.unavailableParts.find((item) => displayParts.includes(item.part));
  const recovering = displayParts.some((displayPart) => payload.completion.recoveringParts.includes(displayPart));
  const missing = displayParts.some((displayPart) => payload.completion.missingParts.includes(displayPart));

  if (present) {
    return {
      state: partStateFromFreshness(displayPartFreshness(payload, present)),
      displayPart: present,
    };
  }
  if (recovering) return { state: "refreshing", displayPart: displayParts[0] };
  if (unavailable) return { state: "unsupported", displayPart: unavailable.part, reason: unavailable.reason };
  if (missing) return { state: "missing", displayPart: displayParts[0] };
  return { state: "missing", displayPart: displayParts[0] };
}

function partStateFromFreshness(freshness: DisplayPartFreshness | undefined): StockDetailPartStatus["state"] {
  return freshness === "stale" || freshness === "fallback" ? "stale_ready" : "ready";
}

function displayPartFreshness(payload: StockDisplayPayload, part: StockDisplayPartName): DisplayPartFreshness | undefined {
  return displayPart(payload, part)?.freshness;
}

function displayPart(payload: StockDisplayPayload, part: StockDisplayPartName): DisplayPart<unknown> | undefined {
  if (part === "identity") return payload.identity;
  if (part === "price") return payload.price;
  if (part === "chart") return payload.chart;
  if (part === "score") return payload.score;
  if (part === "technical") return payload.technical;
  if (part === "fundamentals") return payload.fundamentals;
  if (part === "news") return payload.news;
  if (part === "industryBenchmark") return payload.industryBenchmark;
  if (part === "judgment") return payload.judgment;
  return undefined;
}

function mergeRecords(...values: Array<unknown>): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {};
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const [key, nextValue] of Object.entries(value)) {
      if (nextValue === undefined || nextValue === null) continue;
      const previousValue = merged[key];
      if (Array.isArray(previousValue) && Array.isArray(nextValue)) {
        merged[key] = dedupeArrayValues([...previousValue, ...nextValue]);
      } else {
        merged[key] = nextValue;
      }
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

function dedupeArrayValues(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  const deduped: unknown[] = [];
  for (const value of values) {
    const key = stableArrayValueKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }
  return deduped;
}

function stableArrayValueKey(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(entries));
}

function jobsFromParts(parts: Record<StockDetailPartName, StockDetailPartStatus>): StockDetailViewModel["jobs"] {
  return (Object.entries(parts) as Array<[StockDetailPartName, StockDetailPartStatus]>)
    .filter(([, status]) => status.state === "refreshing" || status.state === "failed_retrying")
    .map(([part, status]) => ({ part, state: status.state === "failed_retrying" ? "retrying" : "queued" }));
}
