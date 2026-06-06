import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_RPC_CHECKS,
  RUNTIME_TABLE_CHECKS,
  parseReadinessOptions,
  publicReadPayload,
  readinessContractPayload,
  readinessOk,
} from "../scripts/supabase_runtime_readiness";

test("TypeScript Supabase readiness contract catches missing required checks", () => {
  const payload = readinessContractPayload({
    required_tables: RUNTIME_TABLE_CHECKS.filter((table) => table !== "public.stock_refresh_jobs"),
    required_rpcs: RUNTIME_RPC_CHECKS.filter((rpc) => rpc !== "claim_stock_refresh_jobs_by_kind"),
  });

  assert.equal(payload.ok, false);
  assert.deepEqual(payload.missing_tables, ["public.stock_refresh_jobs"]);
  assert.deepEqual(payload.missing_rpcs, ["claim_stock_refresh_jobs_by_kind"]);
});

test("TypeScript Supabase readiness contract catches RPC signature and grant drift", () => {
  const payload = readinessContractPayload({
    required_tables: RUNTIME_TABLE_CHECKS,
    required_rpcs: RUNTIME_RPC_CHECKS,
    required_rpc_signatures: [
      {
        name: "claim_stock_refresh_jobs",
        identity_arguments: "p_worker_id text, p_limit integer, p_lock_seconds integer",
      },
    ],
    missing_rpc_grants: ["claim_stock_refresh_jobs_by_kind(text,text,integer,integer)"],
  });

  assert.equal(payload.ok, false);
  assert.match(payload.missing_rpc_signatures.join("\n"), /claim_stock_refresh_jobs_by_kind/);
  assert.deepEqual(payload.missing_rpc_grants, ["claim_stock_refresh_jobs_by_kind(text,text,integer,integer)"]);
});

test("TypeScript Supabase readiness public reads report table failures", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/stock_quote_snapshots")) {
      return new Response(JSON.stringify({ error: "blocked" }), { status: 403 });
    }
    return new Response("[]", { status: 200 });
  };

  try {
    const payload = await publicReadPayload("https://example.supabase.co", "publishable-key", 1000);

    assert.equal(payload.ok, false);
    assert.equal(payload.failures.length, 1);
    assert.equal(payload.failures[0].table, "stock_quote_snapshots");
    assert.equal(payload.failures[0].status, 403);
  } finally {
    global.fetch = originalFetch;
  }
});

test("TypeScript Supabase readiness option parser and ok contract stay stable", () => {
  const options = parseReadinessOptions(["--json", "--timeout", "3"]);
  assert.equal(options.json, true);
  assert.equal(options.timeoutMs, 3000);

  assert.equal(
    readinessOk({
      ok: true,
      readiness_contract: { ok: true },
      public_read: { ok: true },
    }),
    true
  );
  assert.equal(
    readinessOk({
      ok: true,
      readiness_contract: { ok: false },
      public_read: { ok: true },
    }),
    false
  );
});
