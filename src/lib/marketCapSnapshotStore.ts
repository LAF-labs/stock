import { buildMarketCapRankingSnapshot, mergeMarketCapRows } from "@/lib/marketCapRankingProvider";
import { getMarketSession, type MarketCode, type MarketSession, type MarketSessionState } from "@/lib/marketCalendar";
import { safeErrorMessage } from "@/lib/errorSafety";
import { fetchWithTimeout, numericEnv, supabaseAdminConfig, supabaseHeaders, supabaseReadConfig } from "@/lib/supabaseRest";
import type { MarketCapApiResponse, MarketCapDashboardSnapshot, MarketCapRankingRow, MarketCapScope } from "@/lib/marketCapRankingTypes";

type StoredMarketCapSnapshot = {
  scope: MarketCapScope;
  snapshot: MarketCapDashboardSnapshot;
  fetchedAt: string;
  expiresAt: string;
};

type SupabaseMarketCapSnapshotRow = {
  scope: MarketCapScope;
  payload: MarketCapDashboardSnapshot;
  fetched_at: string;
  expires_at: string;
};

type RefreshSession = {
  market: MarketCode;
  state: MarketSessionState;
  closeAt?: string;
};

type RefreshDecisionInput = {
  scope: MarketCapScope;
  nowMs: number;
  snapshotFetchedAt?: string;
  sessions: RefreshSession[];
  freshMs?: number;
};

declare global {
  var __marketCapSnapshotMemoryStore: Map<MarketCapScope, StoredMarketCapSnapshot> | undefined;
  var __marketCapSnapshotInflight: Map<MarketCapScope, Promise<MarketCapDashboardSnapshot | undefined>> | undefined;
}

const TABLE = "market_cap_snapshots";
const FRESH_MS = 60 * 60 * 1000;
const KR_NXT_TIME_ZONE = "Asia/Seoul";
const KR_NXT_START_SECONDS = 8 * 60 * 60;
const KR_NXT_END_SECONDS = 20 * 60 * 60;
const US_AFTER_HOURS_MS = 4 * 60 * 60 * 1000;
const memoryStore = (globalThis.__marketCapSnapshotMemoryStore ??= new Map<MarketCapScope, StoredMarketCapSnapshot>());
const inflightRefreshes = (globalThis.__marketCapSnapshotInflight ??= new Map<MarketCapScope, Promise<MarketCapDashboardSnapshot | undefined>>());

export function shouldRefreshMarketCapSnapshot(input: RefreshDecisionInput): boolean {
  const relevantSessions = input.sessions.filter((session) => scopeMarkets(input.scope).includes(session.market));
  if (!input.snapshotFetchedAt) return true;
  if (!relevantSessions.some((session) => isMarketCapRefreshSessionActive(session, input.nowMs))) return false;
  const fetchedAtMs = Date.parse(input.snapshotFetchedAt);
  if (!Number.isFinite(fetchedAtMs)) return true;
  return input.nowMs - fetchedAtMs >= (input.freshMs ?? FRESH_MS);
}

export function filterMarketCapSnapshotRows(snapshot: MarketCapDashboardSnapshot, sector: string | null | undefined): MarketCapDashboardSnapshot {
  const selected = cleanSector(sector);
  if (!selected) return snapshot;
  const rows = snapshot.rows
    .filter((row) => cleanSector(row.sector).toLowerCase() === selected.toLowerCase())
    .map((row, index) => ({ ...row, rank: index + 1 }));
  return { ...snapshot, rows };
}

export async function getMarketCapSnapshotResponse(input: { scope: MarketCapScope; sector?: string | null; nowMs?: number }): Promise<MarketCapApiResponse> {
  const nowMs = input.nowMs ?? Date.now();
  const snapshot = await readMarketCapSnapshot(input.scope);
  const sessions = await sessionsForScope(input.scope, nowMs);
  const refreshStarted = maybeScheduleMarketCapRefresh(input.scope, snapshot, sessions, nowMs);
  if (!snapshot) {
    return {
      ok: false,
      cache: {
        state: "miss",
        scope: input.scope,
        refreshStarted,
      },
      error: "snapshot_pending",
      message: "시가총액 스냅샷을 준비 중입니다.",
    };
  }

  const state = Date.parse(snapshot.expiresAt) > nowMs ? "fresh" : "stale";
  return {
    ok: true,
    snapshot: filterMarketCapSnapshotRows(snapshot.snapshot, input.sector),
    cache: {
      state,
      scope: input.scope,
      fetchedAt: snapshot.fetchedAt,
      expiresAt: snapshot.expiresAt,
      refreshStarted,
    },
  };
}

export async function readMarketCapSnapshot(scope: MarketCapScope): Promise<StoredMarketCapSnapshot | undefined> {
  const cached = memoryStore.get(scope);
  if (cached) return cloneStoredSnapshot(cached);
  const stored = await readSupabaseMarketCapSnapshot(scope);
  if (stored) memoryStore.set(scope, stored);
  return stored;
}

export async function writeMarketCapSnapshot(snapshot: MarketCapDashboardSnapshot): Promise<void> {
  const stored = {
    scope: snapshot.scope,
    snapshot,
    fetchedAt: snapshot.fetchedAt,
    expiresAt: snapshot.expiresAt,
  };
  memoryStore.set(snapshot.scope, cloneStoredSnapshot(stored));
  await writeSupabaseMarketCapSnapshot(stored);
}

export async function refreshMarketCapSnapshots(input: { nowMs?: number; scopes?: MarketCapScope[] } = {}): Promise<Record<MarketCapScope, boolean>> {
  const nowMs = input.nowMs ?? Date.now();
  const scopes = input.scopes || ["domestic", "overseas", "all"];
  const results: Record<MarketCapScope, boolean> = { all: false, domestic: false, overseas: false };
  const sessions = await Promise.all([getMarketSession("KR", nowMs), getMarketSession("US", nowMs)]);
  const wantsAll = scopes.includes("all");
  const wantsDomestic = scopes.includes("domestic") || wantsAll;
  const wantsOverseas = scopes.includes("overseas") || wantsAll;
  const domesticSession = sessions.find((session) => session.market === "KR");
  const overseasSession = sessions.find((session) => session.market === "US");

  if (wantsDomestic && (isMarketCapRefreshSessionActive(domesticSession, nowMs) || !(await readMarketCapSnapshot("domestic")))) {
    results.domestic = !!(await refreshSingleScopeSnapshot("domestic", nowMs));
  }
  if (wantsOverseas && (isMarketCapRefreshSessionActive(overseasSession, nowMs) || !(await readMarketCapSnapshot("overseas")))) {
    results.overseas = !!(await refreshSingleScopeSnapshot("overseas", nowMs));
  }
  if (wantsAll) {
    results.all = !!(await refreshAllSnapshotFromComponents(nowMs, sessions));
  }

  return results;
}

export const marketCapSnapshotStoreTestHooks = {
  resetMemory() {
    memoryStore.clear();
    inflightRefreshes.clear();
  },
};

function maybeScheduleMarketCapRefresh(
  scope: MarketCapScope,
  snapshot: StoredMarketCapSnapshot | undefined,
  sessions: MarketSession[],
  nowMs: number
): boolean {
  const shouldRefresh = shouldRefreshMarketCapSnapshot({
    scope,
    nowMs,
    snapshotFetchedAt: snapshot?.fetchedAt,
    sessions,
  });
  if (!shouldRefresh) return false;

  if (!inflightRefreshes.has(scope)) {
    const promise = scope === "all"
      ? refreshMarketCapSnapshots({ nowMs, scopes: ["domestic", "overseas", "all"] }).then(() => readMarketCapSnapshot("all").then((item) => item?.snapshot))
      : refreshSingleScopeSnapshot(scope, nowMs);
    inflightRefreshes.set(scope, promise);
    void promise.catch((error) => {
      console.warn("market_cap_refresh_failed", { scope, error: safeErrorMessage(error) });
    }).finally(() => {
      inflightRefreshes.delete(scope);
    });
  }
  return true;
}

async function refreshSingleScopeSnapshot(scope: Exclude<MarketCapScope, "all">, nowMs: number): Promise<MarketCapDashboardSnapshot | undefined> {
  const snapshot = await buildMarketCapRankingSnapshot({ scope, nowMs });
  await writeMarketCapSnapshot(snapshot);
  return snapshot;
}

async function refreshAllSnapshotFromComponents(nowMs: number, sessions: MarketSession[]): Promise<MarketCapDashboardSnapshot | undefined> {
  const domestic = await readMarketCapSnapshot("domestic");
  const overseas = await readMarketCapSnapshot("overseas");
  const rows: MarketCapRankingRow[] = [
    ...(domestic?.snapshot.rows || []),
    ...(overseas?.snapshot.rows || []),
  ];
  if (!rows.length && !domestic && !overseas) return undefined;
  const mergedRows = mergeMarketCapRows(rows, { scope: "all", limit: 100 });
  const sectors = [...new Set(mergedRows.map((row) => cleanSector(row.sector)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const fetchedAt = new Date(nowMs).toISOString();
  const sourceFetchedAt = [domestic?.fetchedAt, overseas?.fetchedAt].filter(Boolean).sort().at(-1) || fetchedAt;
  const snapshot: MarketCapDashboardSnapshot = {
    scope: "all",
    rows: mergedRows,
    sectors,
    fetchedAt: sourceFetchedAt,
    updatedAt: fetchedAt,
    expiresAt: new Date(nowMs + FRESH_MS).toISOString(),
    source: "mixed",
    usdKrwRate: domestic?.snapshot.usdKrwRate || overseas?.snapshot.usdKrwRate,
    sessions,
  };
  await writeMarketCapSnapshot(snapshot);
  return snapshot;
}

async function sessionsForScope(scope: MarketCapScope, nowMs: number): Promise<MarketSession[]> {
  return Promise.all(scopeMarkets(scope).map((market) => getMarketSession(market, nowMs)));
}

function scopeMarkets(scope: MarketCapScope): MarketCode[] {
  if (scope === "domestic") return ["KR"];
  if (scope === "overseas") return ["US"];
  return ["KR", "US"];
}

function isMarketCapRefreshSessionActive(session: RefreshSession | undefined, nowMs: number): boolean {
  if (!session) return false;
  if (session.state === "open") return true;
  if (session.market === "KR") return session.state === "closed" && isWithinKoreanNxtHours(nowMs);
  if (session.market === "US") return session.state === "closed" && isWithinUsAfterHours(session, nowMs);
  return false;
}

function isWithinKoreanNxtHours(nowMs: number): boolean {
  const seconds = secondsInTimeZone(nowMs, KR_NXT_TIME_ZONE);
  return seconds >= KR_NXT_START_SECONDS && seconds <= KR_NXT_END_SECONDS;
}

function isWithinUsAfterHours(session: RefreshSession, nowMs: number): boolean {
  if (!session.closeAt) return false;
  const closeMs = Date.parse(session.closeAt);
  if (!Number.isFinite(closeMs)) return false;
  return nowMs > closeMs && nowMs <= closeMs + US_AFTER_HOURS_MS;
}

function secondsInTimeZone(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || "0");
  return value("hour") * 60 * 60 + value("minute") * 60 + value("second");
}

async function readSupabaseMarketCapSnapshot(scope: MarketCapScope): Promise<StoredMarketCapSnapshot | undefined> {
  const config = supabaseReadConfig();
  if (!config) return undefined;
  try {
    const query = new URLSearchParams({
      scope: `eq.${scope}`,
      select: "scope,payload,fetched_at,expires_at",
      limit: "1",
    });
    const response = await fetchWithTimeout(
      `${config.url}/rest/v1/${TABLE}?${query.toString()}`,
      { headers: supabaseHeaders(config.key), cache: "no-store" },
      numericEnv("MARKET_CAP_SUPABASE_READ_TIMEOUT_MS", 1_500)
    );
    if (!response.ok) return undefined;
    const rows = await response.json() as SupabaseMarketCapSnapshotRow[];
    const row = rows[0];
    if (!row?.payload) return undefined;
    return {
      scope: row.scope,
      snapshot: row.payload,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
    };
  } catch {
    return undefined;
  }
}

async function writeSupabaseMarketCapSnapshot(snapshot: StoredMarketCapSnapshot): Promise<void> {
  const config = supabaseAdminConfig();
  if (!config) return;
  try {
    const response = await fetchWithTimeout(
      `${config.url}/rest/v1/${TABLE}?on_conflict=scope`,
      {
        method: "POST",
        headers: {
          ...supabaseHeaders(config.key),
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          scope: snapshot.scope,
          payload: snapshot.snapshot,
          fetched_at: snapshot.fetchedAt,
          expires_at: snapshot.expiresAt,
          updated_at: new Date().toISOString(),
        }),
      },
      numericEnv("MARKET_CAP_SUPABASE_WRITE_TIMEOUT_MS", 5_000)
    );
    if (!response.ok) console.warn("market_cap_snapshot_write_failed", { status: response.status });
  } catch (error) {
    console.warn("market_cap_snapshot_write_failed", { error: safeErrorMessage(error) });
  }
}

function cloneStoredSnapshot(snapshot: StoredMarketCapSnapshot): StoredMarketCapSnapshot {
  return {
    ...snapshot,
    snapshot: {
      ...snapshot.snapshot,
      rows: snapshot.snapshot.rows.map((row) => ({ ...row })),
      sectors: [...snapshot.snapshot.sectors],
      sessions: snapshot.snapshot.sessions?.map((session) => ({ ...session })),
    },
  };
}

function cleanSector(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
