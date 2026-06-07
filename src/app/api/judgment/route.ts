import { NextRequest, NextResponse } from "next/server";
import { apiLimitPolicy } from "@/lib/apiRateLimit";
import { guardedRateLimit } from "@/lib/apiRequestGuards";
import { readJsonObjectWithLimit, jsonError, sameOriginBrowserWriteGuard } from "@/lib/apiGuards";
import { judgmentBenchmarkCacheToken, judgmentBucketStart, judgmentCacheKeyFor } from "@/lib/judgmentCache";
import { getIndustryBenchmarksForStock } from "@/lib/industryBenchmarks";
import { enrichStockPayloadWithSymbolProfile, payloadHasUsableIndustryProfile } from "@/lib/symbolProfiles";
import {
  buildRuleBasedJudgment,
  cachedRuleBasedJudgment,
  compactRuleJudgmentStock,
  tickerFromRuleJudgmentStock,
  validRuleJudgmentStock,
  type RuleBasedJudgment,
} from "@/lib/ruleBasedJudgment";
import { fetchWithTimeout, numericEnv, supabaseAdminConfig, supabaseHeaders, supabaseReadConfig } from "@/lib/supabaseRest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RULE_MODEL = "rule-v2";
const PROMPT_VERSION = "stock-rule-judge-v3";
const SUPABASE_TABLE = "stock_rule_judgments";
const MAX_JUDGMENT_BODY_BYTES = 64 * 1024;

declare global {
  var __stockRuleJudgmentCache: Map<string, { value: RuleBasedJudgment; expiresAt: number }> | undefined;
}

const memoryJudgments = (globalThis.__stockRuleJudgmentCache ??= new Map<string, { value: RuleBasedJudgment; expiresAt: number }>());

function todayKey(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function cacheKeyFor(model: string, date: Date, benchmarkToken: string): string {
  return judgmentCacheKeyFor(model, date, PROMPT_VERSION, benchmarkToken);
}

async function getCachedJudgment(
  ticker: string,
  cacheDate: string,
  cacheKey: string,
  model: string,
  cacheBucketStart: string
): Promise<RuleBasedJudgment | undefined> {
  const memoryKey = judgmentMemoryKey(ticker, cacheKey);
  const memory = memoryJudgments.get(memoryKey);
  if (memory && memory.expiresAt > Date.now()) return { ...memory.value, cached: true };

  const config = supabaseReadConfig();
  if (!config || !ticker) return undefined;

  try {
    const url = `${config.url}/rest/v1/${SUPABASE_TABLE}?ticker=eq.${encodeURIComponent(ticker)}&cache_date=eq.${encodeURIComponent(cacheDate)}&model=eq.${encodeURIComponent(cacheKey)}&select=judgment&limit=1`;
    const response = await fetchWithTimeout(url, {
      headers: supabaseHeaders(config.key),
      cache: "no-store",
    }, 1_500);
    if (!response.ok) return undefined;
    const rows = (await response.json()) as Array<{ judgment?: Record<string, unknown> }>;
    const row = rows[0];
    if (!row?.judgment) return undefined;
    const judgment = cachedRuleBasedJudgment(row.judgment, { model, promptVersion: PROMPT_VERSION, cacheBucketStart });
    if (judgment) setMemoryJudgment(memoryKey, judgment);
    return judgment;
  } catch {
    return undefined;
  }
}

async function saveCachedJudgment(ticker: string, cacheDate: string, judgment: RuleBasedJudgment, cacheKey: string) {
  setMemoryJudgment(judgmentMemoryKey(ticker, cacheKey), judgment);

  const config = supabaseAdminConfig();
  if (!config || !ticker) return;

  try {
    await fetchWithTimeout(`${config.url}/rest/v1/${SUPABASE_TABLE}?ticker=eq.${encodeURIComponent(ticker)}&cache_date=neq.${encodeURIComponent(cacheDate)}`, {
      method: "DELETE",
      headers: supabaseHeaders(config.key),
    }, 1_500);

    await fetchWithTimeout(`${config.url}/rest/v1/${SUPABASE_TABLE}?on_conflict=ticker,cache_date,model`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(config.key),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        ticker,
        cache_date: cacheDate,
        judgment: {
          headline: judgment.headline,
          body: judgment.body,
          watch: judgment.watch,
          tone: judgment.tone,
          model: judgment.model,
          promptVersion: judgment.promptVersion,
          cacheBucketStart: judgment.cacheBucketStart,
        },
        model: cacheKey,
      }),
    }, 1_500);
  } catch {
    // Cache persistence is best-effort; rule generation itself is deterministic and cheap.
  }
}

export async function POST(request: NextRequest) {
  const browserWrite = sameOriginBrowserWriteGuard(request);
  if (!browserWrite.ok) {
    return jsonError(browserWrite.status, browserWrite.error, browserWrite.message);
  }

  const body = await readJsonObjectWithLimit(
    request,
    numericEnv("STOCK_JUDGMENT_BODY_MAX_BYTES", MAX_JUDGMENT_BODY_BYTES)
  );
  if (!body.ok) {
    return jsonError(body.status, body.error, body.message);
  }

  const rateLimit = await guardedRateLimit(
    request,
    apiLimitPolicy("stock_rule_judgment", 600, 60),
    "judgment",
    "판단 요청이 너무 많아요. 잠시 후 다시 시도해주세요."
  );
  if (!rateLimit.ok) return rateLimit.response;

  const enrichedPayload = payloadHasUsableIndustryProfile(body.value)
    ? body.value
    : await enrichStockPayloadWithSymbolProfile(body.value);
  const stock = compactRuleJudgmentStock(enrichedPayload);
  const ticker = tickerFromRuleJudgmentStock(stock);
  if (!validRuleJudgmentStock(stock, ticker)) {
    return NextResponse.json({ ok: false, error: "invalid_stock_payload", message: "판단을 만들 주식 데이터가 부족해요." }, { status: 400 });
  }

  const cacheDate = todayKey();
  const model = RULE_MODEL;
  const now = new Date();
  const cacheBucketStart = judgmentBucketStart(now);
  const benchmarks = await getIndustryBenchmarksForStock(stock);
  const benchmarkToken = judgmentBenchmarkCacheToken(benchmarks);
  const cacheKey = cacheKeyFor(model, now, benchmarkToken);
  const cached = await getCachedJudgment(ticker, cacheDate, cacheKey, model, cacheBucketStart);
  if (cached) {
    return judgmentResponse(cached);
  }

  const judgment = buildRuleBasedJudgment(stock, {
    benchmarks,
    model,
    promptVersion: PROMPT_VERSION,
    cacheBucketStart,
  });

  await saveCachedJudgment(ticker, cacheDate, judgment, cacheKey);
  return judgmentResponse(judgment);
}

function judgmentResponse(judgment: RuleBasedJudgment) {
  return NextResponse.json(
    {
      ok: true,
      judgment,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

function judgmentMemoryKey(ticker: string, cacheKey: string): string {
  return `${ticker}:${cacheKey}`;
}

function setMemoryJudgment(key: string, judgment: RuleBasedJudgment) {
  memoryJudgments.set(key, {
    value: judgment,
    expiresAt: Date.now() + 6 * 60 * 60 * 1000,
  });
  pruneMemoryJudgments();
}

function pruneMemoryJudgments() {
  const limit = numericEnv("STOCK_RULE_JUDGMENT_MEMORY_CACHE_MAX_ENTRIES", 5_000);
  if (memoryJudgments.size <= limit) return;
  const now = Date.now();
  for (const [key, item] of memoryJudgments) {
    if (item.expiresAt <= now) memoryJudgments.delete(key);
  }
  while (memoryJudgments.size > limit) {
    const oldestKey = memoryJudgments.keys().next().value;
    if (!oldestKey) break;
    memoryJudgments.delete(oldestKey);
  }
}
