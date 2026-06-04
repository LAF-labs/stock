import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout, supabaseAdminConfig, supabaseHeaders, supabaseReadConfig } from "@/lib/supabaseRest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5-mini";
const PROMPT_VERSION = "stock-judge-v3";
const TIMEOUT_MS = 14_000;
const SUPABASE_TABLE = "stock_ai_judgments";

type CompactMetric = {
  label?: string;
  value?: unknown;
};

type CompactComponent = {
  label?: string;
  score?: unknown;
  metrics?: CompactMetric[];
};

type AiJudgmentPayload = {
  headline: string;
  body: string;
  watch: string;
  tone: "positive" | "neutral" | "cautious";
  model?: string;
  promptVersion?: string;
  cached?: boolean;
};

function envValue(name: string): string | undefined {
  try {
    const envFile = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    const match = envFile.match(new RegExp(`^${name}=(.*)$`, "m"));
    const value = match?.[1]?.trim();
    if (value) return value;
  } catch {
    // Fall back to the process environment when .env.local is absent, such as in production.
  }

  return process.env[name];
}

function takeMetrics(value: unknown, count = 8): CompactMetric[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, count).map((item) => {
    if (!item || typeof item !== "object") return {};
    const row = item as Record<string, unknown>;
    return {
      label: typeof row.label === "string" ? row.label : undefined,
      value: row.value,
    };
  });
}

function metricByLabel(value: unknown, labels: string[]): CompactMetric | undefined {
  if (!Array.isArray(value)) return undefined;
  const row = value.find((item) => {
    if (!item || typeof item !== "object") return false;
    const label = (item as Record<string, unknown>).label;
    return typeof label === "string" && labels.some((candidate) => label.includes(candidate));
  });
  if (!row || typeof row !== "object") return undefined;
  const record = row as Record<string, unknown>;
  return {
    label: typeof record.label === "string" ? record.label : undefined,
    value: record.value,
  };
}

function compactPayload(raw: Record<string, unknown>) {
  const components = Array.isArray(raw.components)
    ? raw.components.slice(0, 5).map((item) => {
        const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        return {
          label: typeof row.label === "string" ? row.label : undefined,
          score: row.score,
          metrics: takeMetrics(row.metrics, 2),
        } satisfies CompactComponent;
      })
    : [];

  const ordered = [...components].sort((a, b) => Number(b.score ?? -1) - Number(a.score ?? -1));
  const weakest = [...components].sort((a, b) => Number(a.score ?? 101) - Number(b.score ?? 101));

  return {
    symbol: raw.symbol || raw.requested_ticker,
    name: raw.name,
    latest_bar_date: raw.latest_bar_date,
    score: raw.score,
    signal: (raw.sia_snapshot as Record<string, unknown> | undefined)?.raw_signal,
    risk: (raw.sia_snapshot as Record<string, unknown> | undefined)?.risk_level,
    key_metrics: [
      metricByLabel(raw.key_metrics, ["전일 대비"]),
      metricByLabel(raw.key_metrics, ["시가총액"]),
      metricByLabel(raw.key_metrics, ["1개월"]),
      metricByLabel(raw.key_metrics, ["3개월"]),
      metricByLabel(raw.key_metrics, ["6개월"]),
      metricByLabel(raw.key_metrics, ["52주"]),
    ].filter(Boolean),
    valuation: [
      metricByLabel(raw.key_metrics, ["PER"]),
      metricByLabel(raw.key_metrics, ["PBR"]),
      metricByLabel(raw.valuation_rows, ["Forward PER"]),
      metricByLabel(raw.valuation_rows, ["EV/Revenue"]),
    ].filter(Boolean),
    strongest: ordered[0],
    weakest: weakest[0],
    components,
  };
}

function tickerFromPayload(stock: ReturnType<typeof compactPayload>): string {
  return String(stock.symbol || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

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

function cacheKeyFor(model: string): string {
  return `${model}:${PROMPT_VERSION}`;
}

const SYSTEM_PROMPT = [
  "너는 한국어 주식 콘텐츠 에디터다.",
  "목표: 초보자가 오늘 이 주식을 어떻게 읽으면 되는지 쉽게 설명한다.",
  "제공된 JSON 숫자만 근거로 쓴다. 없는 실적, 뉴스, 목표가, 배당, 미래 사건을 만들지 않는다.",
  "투자 행동을 지시하지 않는다. 매수, 매도, 추천, 보류, 적정가, 목표가라는 단어를 쓰지 않는다.",
  "해요체로 쓴다. 문장 끝은 요/해요/예요로 끝낸다. 야/다/니다/십시오 체를 쓰지 않는다.",
  "score 해석: 80 이상은 좋음, 65~79는 괜찮지만 확인 필요, 50~64는 애매함, 50 미만은 조심.",
  "risk가 HIGH면 변동성이나 확인 포인트를 반드시 반영한다.",
  "strongest는 강점, weakest는 먼저 확인할 점으로 다룬다.",
  "출력은 JSON만 작성한다.",
].join("\n");

function buildUserPrompt(stock: ReturnType<typeof compactPayload>): string {
  return [
    "아래 데이터만 근거로 판단문을 써요.",
    "headline: 16자 안팎의 쉬운 판단. 종목명, 티커, 오늘, 점검 포인트, HOLD, BUY, SELL, 글자수 지시어를 쓰지 않아요.",
    "headline 예시 톤: '수익성은 좋고 빚은 봐야 해요', '흐름은 좋지만 비싸 보여요'.",
    "body: 정확히 2문장. 첫 문장은 점수와 전체 분위기, 둘째 문장은 강점과 확인할 점을 쉽게 설명해요.",
    "watch: 정확히 1문장. 사용자가 먼저 볼 숫자나 위험 포인트 하나만 말해요.",
    "tone: positive, neutral, cautious 중 하나.",
    JSON.stringify(stock),
  ].join("\n");
}

function outputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .flatMap((item) => {
      const content = item && typeof item === "object" ? (item as Record<string, unknown>).content : undefined;
      return Array.isArray(content) ? content : [];
    })
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return typeof row.text === "string" ? row.text : "";
    })
    .join("");
}

function softerKorean(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replaceAll("높은 편이다.", "높은 편이에요.")
    .replaceAll("낮은 편이다.", "낮은 편이에요.")
    .replaceAll("양호한 편이다.", "양호한 편이에요.")
    .replaceAll("부담스러운 편이다.", "부담스러운 편이에요.")
    .replaceAll("관찰 필요.", "관찰이 필요해요.")
    .replaceAll("확인 필요.", "확인이 필요해요.")
    .replaceAll("주의 필요.", "주의가 필요해요.")
    .replaceAll("점검 필요.", "점검이 필요해요.")
    .replaceAll("비싸다.", "비싸요.")
    .replaceAll("저렴하다.", "저렴해요.")
    .replaceAll("강하다.", "강해요.")
    .replaceAll("약하다.", "약해요.")
    .replaceAll("주의.", "주의가 필요해요.")
    .replaceAll(" 주의", " 주의가 필요해요.")
    .replaceAll("수 있음", "수 있어요.")
    .replaceAll("평가됩니다.", "평가돼요.")
    .replaceAll("예상됩니다.", "예상돼요.")
    .replaceAll("보입니다.", "보여요.")
    .replaceAll("됩니다.", "돼요.")
    .replaceAll("주시하세요.", "봐야 해요.")
    .replaceAll("확인하세요.", "확인해요.")
    .replaceAll("살펴보세요.", "살펴봐요.")
    .replaceAll("위험이 큽니다.", "위험이 커요.")
    .replaceAll("부담이 큽니다.", "부담이 커요.")
    .replaceAll("필요가 있습니다.", "필요가 있어요.")
    .replaceAll("여지가 있습니다.", "여지가 있어요.")
    .replaceAll("가능성이 있습니다.", "가능성이 있어요.")
    .replaceAll("있습니다.", "있어요.")
    .replaceAll("없습니다.", "없어요.")
    .replaceAll("높습니다.", "높아요.")
    .replaceAll("낮습니다.", "낮아요.")
    .replaceAll("강합니다.", "강해요.")
    .replaceAll("약합니다.", "약해요.")
    .replaceAll("양호합니다.", "양호해요.")
    .replaceAll("필요합니다.", "필요해요.")
    .replaceAll("중요합니다.", "중요해요.")
    .replaceAll("확인해야 합니다.", "확인해야 해요.")
    .replaceAll("봐야 합니다.", "봐야 해요.")
    .replaceAll("상태입니다.", "상태예요.")
    .replaceAll("편입니다.", "편이에요.")
    .replaceAll("여부입니다.", "여부를 봐야 해요.")
    .replaceAll("인지입니다.", "인지 봐야 해요.")
    .replaceAll("인지이에요.", "인지 봐야 해요.")
    .replaceAll("입니다.", "이에요.")
    .replaceAll("합니다.", "해요.")
    .replace(/([가-힣])이다\./g, "$1이에요.")
    .replace(/이야\./g, "이에요.")
    .replace(/야\./g, "예요.");
}

function cleanHeadline(value: unknown): string {
  return softerKorean(value)
    .replace(/\([A-Z0-9.-]{1,8}\)/g, "")
    .replace(/매수\/매도\s*금지\s*(대신)?[:：]?\s*/g, "")
    .replace(/보유\s*권고/gi, "HOLD 신호")
    .replace(/\(?\s*\d+\s*자\s*(이내|내외)?\s*\)?/g, "")
    .replace(/headline|제목|글자 수|제한/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeJudgment(judgment: Record<string, unknown>, model: string, cached = false): AiJudgmentPayload {
  const tone = judgment.tone === "positive" || judgment.tone === "cautious" ? judgment.tone : "neutral";
  const headline = cleanHeadline(judgment.headline);
  const safeHeadline =
    !headline || headline.length > 24 || /\(|\)|[A-Z]{2,}|오늘|점검|포인트|금지|권고|매수|매도|보류|headline|글자/.test(headline)
      ? tone === "cautious"
        ? "확인할 점이 있어요"
        : tone === "positive"
          ? "좋은 점이 보여요"
          : "균형 있게 봐야 해요"
      : headline;
  return {
    headline: safeHeadline,
    body: softerKorean(judgment.body),
    watch: softerKorean(judgment.watch),
    tone,
    model,
    promptVersion: PROMPT_VERSION,
    cached,
  };
}

async function getCachedJudgment(ticker: string, cacheDate: string, cacheKey: string, model: string): Promise<AiJudgmentPayload | undefined> {
  const config = supabaseReadConfig();
  if (!config || !ticker) return undefined;

  try {
    const url = `${config.url}/rest/v1/${SUPABASE_TABLE}?ticker=eq.${encodeURIComponent(ticker)}&cache_date=eq.${encodeURIComponent(cacheDate)}&model=eq.${encodeURIComponent(cacheKey)}&select=judgment&limit=1`;
    const response = await fetchWithTimeout(url, {
      headers: supabaseHeaders(config.key),
      cache: "no-store",
    }, 2_000);
    if (!response.ok) return undefined;
    const rows = (await response.json()) as Array<{ judgment?: Record<string, unknown> }>;
    const row = rows[0];
    if (!row?.judgment) return undefined;
    return normalizeJudgment(row.judgment, model, true);
  } catch {
    return undefined;
  }
}

async function saveCachedJudgment(ticker: string, cacheDate: string, judgment: AiJudgmentPayload, cacheKey: string) {
  const config = supabaseAdminConfig();
  if (!config || !ticker) return;

  try {
    await fetchWithTimeout(`${config.url}/rest/v1/${SUPABASE_TABLE}?ticker=eq.${encodeURIComponent(ticker)}&cache_date=neq.${encodeURIComponent(cacheDate)}`, {
      method: "DELETE",
      headers: supabaseHeaders(config.key),
    });

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
          promptVersion: PROMPT_VERSION,
        },
        model: cacheKey,
      }),
    });
  } catch {
    // Cache is an optimization; generation should not fail because Supabase is unavailable.
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json", message: "요청 본문이 올바르지 않아요." }, { status: 400 });
  }

  const stock = compactPayload(body);
  const ticker = tickerFromPayload(stock);
  const cacheDate = todayKey();
  const model = envValue("OPENAI_MODEL") || DEFAULT_MODEL;
  const cacheKey = cacheKeyFor(model);
  const cached = await getCachedJudgment(ticker, cacheDate, cacheKey, model);
  if (cached) {
    return NextResponse.json(
      {
        ok: true,
        judgment: cached,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const apiKey = envValue("OPENAI_API_KEY");
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing_openai_key",
        message: "OPENAI_API_KEY가 서버에 설정되어 있지 않아요.",
      },
      { status: 503 }
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: buildUserPrompt(stock),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "stock_judgment",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                headline: { type: "string" },
                body: { type: "string" },
                watch: { type: "string" },
                tone: { type: "string", enum: ["positive", "neutral", "cautious"] },
              },
              required: ["headline", "body", "watch", "tone"],
            },
          },
          verbosity: "low",
        },
        reasoning: {
          effort: "minimal",
        },
        max_output_tokens: 260,
      }),
    });

    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const error = payload.error && typeof payload.error === "object" ? (payload.error as Record<string, unknown>) : undefined;
      const providerMessage = typeof error?.message === "string" ? error.message : "";
      const message = providerMessage.toLowerCase().includes("api key")
        ? "OpenAI API key가 올바르지 않아요. 새 키를 서버에 설정해야 해요."
        : "AI 판단을 만들지 못했어요.";
      return NextResponse.json(
        {
          ok: false,
          error: "openai_failed",
          message,
        },
        { status: 502 }
      );
    }

    const text = outputText(payload);
    const judgment = normalizeJudgment(JSON.parse(text) as Record<string, unknown>, model);
    await saveCachedJudgment(ticker, cacheDate, judgment, cacheKey);
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
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "judgment_unavailable",
        message: error instanceof Error && error.name === "AbortError" ? "AI 판단 요청 시간이 초과됐어요." : "AI 판단을 불러오지 못했어요.",
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
