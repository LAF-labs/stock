import test from "node:test";
import assert from "node:assert/strict";

import {
  filterMarketCapSnapshotRows,
  marketCapSnapshotStoreTestHooks,
  readMarketCapSnapshot,
  refreshMarketCapSnapshots,
  shouldRefreshMarketCapSnapshot,
  writeMarketCapSnapshot,
} from "../src/lib/marketCapSnapshotStore";
import type { MarketCapDashboardSnapshot, MarketCapScope } from "../src/lib/marketCapRankingTypes";

test("shouldRefreshMarketCapSnapshot keeps serving cached data when every relevant market is closed", () => {
  assert.equal(shouldRefreshMarketCapSnapshot({
    scope: "all",
    nowMs: Date.parse("2026-06-12T11:01:00.000Z"),
    snapshotFetchedAt: "2026-06-12T10:00:00.000Z",
    sessions: [
      { market: "KR", state: "closed" },
      { market: "US", state: "holiday" },
    ],
  }), false);
});

test("shouldRefreshMarketCapSnapshot starts an initial snapshot even when markets are closed", () => {
  assert.equal(shouldRefreshMarketCapSnapshot({
    scope: "all",
    nowMs: Date.parse("2026-06-12T17:05:00.000Z"),
    sessions: [
      { market: "KR", state: "closed" },
      { market: "US", state: "closed" },
    ],
  }), true);
});

test("shouldRefreshMarketCapSnapshot refreshes stale snapshots while a relevant market is open", () => {
  assert.equal(shouldRefreshMarketCapSnapshot({
    scope: "domestic",
    nowMs: Date.parse("2026-06-12T11:10:00.000Z"),
    snapshotFetchedAt: "2026-06-12T10:00:00.000Z",
    sessions: [{ market: "KR", state: "open" }],
  }), true);
});

test("shouldRefreshMarketCapSnapshot refreshes stale US snapshots during after-hours", () => {
  assert.equal(shouldRefreshMarketCapSnapshot({
    scope: "overseas",
    nowMs: Date.parse("2026-06-12T21:30:00.000Z"),
    snapshotFetchedAt: "2026-06-12T20:00:00.000Z",
    sessions: [{ market: "US", state: "closed", closeAt: "2026-06-12T20:00:00.000Z" }],
  }), true);
});

test("shouldRefreshMarketCapSnapshot refreshes stale KR snapshots during NXT hours", () => {
  assert.equal(shouldRefreshMarketCapSnapshot({
    scope: "domestic",
    nowMs: Date.parse("2026-06-12T08:00:00.000Z"),
    snapshotFetchedAt: "2026-06-12T06:30:00.000Z",
    sessions: [{ market: "KR", state: "closed", closeAt: "2026-06-12T06:30:00.000Z" }],
  }), true);
});

test("shouldRefreshMarketCapSnapshot stops US refreshes after after-hours", () => {
  assert.equal(shouldRefreshMarketCapSnapshot({
    scope: "overseas",
    nowMs: Date.parse("2026-06-13T00:01:00.000Z"),
    snapshotFetchedAt: "2026-06-12T20:00:00.000Z",
    sessions: [{ market: "US", state: "closed", closeAt: "2026-06-12T20:00:00.000Z" }],
  }), false);
});

test("shouldRefreshMarketCapSnapshot refreshes stale KR snapshots shortly after NXT hours", () => {
  assert.equal(shouldRefreshMarketCapSnapshot({
    scope: "domestic",
    nowMs: Date.parse("2026-06-12T11:01:00.000Z"),
    snapshotFetchedAt: "2026-06-12T09:30:00.000Z",
    sessions: [{ market: "KR", state: "closed", closeAt: "2026-06-12T06:30:00.000Z" }],
  }), true);
});

test("shouldRefreshMarketCapSnapshot stops KR refreshes after the NXT close grace window", () => {
  assert.equal(shouldRefreshMarketCapSnapshot({
    scope: "domestic",
    nowMs: Date.parse("2026-06-12T13:01:00.000Z"),
    snapshotFetchedAt: "2026-06-12T09:30:00.000Z",
    sessions: [{ market: "KR", state: "closed", closeAt: "2026-06-12T06:30:00.000Z" }],
  }), false);
});

test("shouldRefreshMarketCapSnapshot does not refresh fresh snapshots during open markets", () => {
  assert.equal(shouldRefreshMarketCapSnapshot({
    scope: "overseas",
    nowMs: Date.parse("2026-06-12T11:45:00.000Z"),
    snapshotFetchedAt: "2026-06-12T11:00:00.000Z",
    sessions: [{ market: "US", state: "open" }],
  }), false);
});

test("filterMarketCapSnapshotRows applies a single DB sector filter", () => {
  const snapshot: MarketCapDashboardSnapshot = {
    scope: "all",
    rows: [
      {
        rank: 1,
        ticker: "US:NVDA",
        market: "US",
        symbol: "NVDA",
        name: "NVIDIA",
        price: 195,
        priceChange: 2,
        priceChangePercent: 0.01,
        marketCap: 4_750_000_000_000,
        marketCapCurrency: "USD",
        marketCapUsd: 4_750_000_000_000,
        sector: "Technology",
        fetchedAt: "2026-06-12T11:00:00.000Z",
        source: "kis-overseas",
      },
      {
        rank: 2,
        ticker: "US:LLY",
        market: "US",
        symbol: "LLY",
        name: "Eli Lilly",
        price: 800,
        priceChange: -3,
        priceChangePercent: -0.004,
        marketCap: 900_000_000_000,
        marketCapCurrency: "USD",
        marketCapUsd: 900_000_000_000,
        sector: "Healthcare",
        fetchedAt: "2026-06-12T11:00:00.000Z",
        source: "kis-overseas",
      },
    ],
    sectors: ["Healthcare", "Technology"],
    fetchedAt: "2026-06-12T11:00:00.000Z",
    updatedAt: "2026-06-12T11:00:00.000Z",
    expiresAt: "2026-06-12T12:00:00.000Z",
    source: "kis",
  };

  assert.deepEqual(filterMarketCapSnapshotRows(snapshot, "Technology").rows.map((row) => row.ticker), ["US:NVDA"]);
});

test("refreshMarketCapSnapshots seeds missing all snapshots outside market hours", async () => {
  const env = captureEnv();
  clearMarketCapRuntimeEnv();
  marketCapSnapshotStoreTestHooks.resetMemory();

  try {
    const results = await refreshMarketCapSnapshots({ nowMs: Date.parse("2026-06-13T00:30:00.000Z") });
    const domestic = await readMarketCapSnapshot("domestic");
    const overseas = await readMarketCapSnapshot("overseas");
    const all = await readMarketCapSnapshot("all");

    assert.equal(results.domestic, true);
    assert.equal(results.overseas, true);
    assert.equal(results.all, true);
    assert.equal(domestic?.snapshot.scope, "domestic");
    assert.equal(overseas?.snapshot.scope, "overseas");
    assert.equal(all?.snapshot.scope, "all");
  } finally {
    restoreEnv(env);
    marketCapSnapshotStoreTestHooks.resetMemory();
  }
});

test("refreshMarketCapSnapshots refreshes stale domestic snapshots during KR NXT hours", async () => {
  const env = captureEnv();
  clearMarketCapRuntimeEnv();
  marketCapSnapshotStoreTestHooks.resetMemory();

  try {
    await writeMarketCapSnapshot(emptySnapshot("domestic", "2026-06-12T06:30:00.000Z"));

    const results = await refreshMarketCapSnapshots({
      nowMs: Date.parse("2026-06-12T08:00:00.000Z"),
      scopes: ["domestic"],
    });
    const domestic = await readMarketCapSnapshot("domestic");

    assert.equal(results.domestic, true);
    assert.equal(domestic?.fetchedAt, "2026-06-12T08:00:00.000Z");
  } finally {
    restoreEnv(env);
    marketCapSnapshotStoreTestHooks.resetMemory();
  }
});

test("refreshMarketCapSnapshots refreshes stale overseas snapshots during US after-hours", async () => {
  const env = captureEnv();
  clearMarketCapRuntimeEnv();
  marketCapSnapshotStoreTestHooks.resetMemory();

  try {
    await writeMarketCapSnapshot(emptySnapshot("overseas", "2026-06-12T19:00:00.000Z"));

    const results = await refreshMarketCapSnapshots({
      nowMs: Date.parse("2026-06-12T21:30:00.000Z"),
      scopes: ["overseas"],
    });
    const overseas = await readMarketCapSnapshot("overseas");

    assert.equal(results.overseas, true);
    assert.equal(overseas?.fetchedAt, "2026-06-12T21:30:00.000Z");
  } finally {
    restoreEnv(env);
    marketCapSnapshotStoreTestHooks.resetMemory();
  }
});

const MARKET_CAP_ENV_NAMES = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STOCK_API_APP_KEY",
  "STOCK_API_APP_SECRET",
  "KIS_APP_KEY",
  "KIS_APP_SECRET",
  "STOCK_API_BASE",
  "KIS_API_BASE",
] as const;

function captureEnv(): Record<string, string | undefined> {
  return Object.fromEntries(MARKET_CAP_ENV_NAMES.map((name) => [name, process.env[name]]));
}

function restoreEnv(env: Record<string, string | undefined>) {
  for (const name of MARKET_CAP_ENV_NAMES) {
    const value = env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function clearMarketCapRuntimeEnv() {
  for (const name of MARKET_CAP_ENV_NAMES) {
    delete process.env[name];
  }
}

function emptySnapshot(scope: MarketCapScope, fetchedAt: string): MarketCapDashboardSnapshot {
  return {
    scope,
    rows: [],
    sectors: [],
    fetchedAt,
    updatedAt: fetchedAt,
    expiresAt: fetchedAt,
    source: "kis",
  };
}
