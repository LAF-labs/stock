import test from "node:test";
import assert from "node:assert/strict";

import { supabaseAdminConfig, supabaseReadConfig } from "../src/lib/supabaseRest";

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test.afterEach(restoreEnv);

test("Supabase read config prefers the publishable key over service role", () => {
  process.env.SUPABASE_URL = "https://example.supabase.co/";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  assert.deepEqual(supabaseReadConfig(), {
    url: "https://example.supabase.co",
    key: "publishable-key",
    keySource: "publishable",
  });
});

test("Supabase read config can fall back to service role when no publishable key exists", () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  assert.deepEqual(supabaseReadConfig(), {
    url: "https://example.supabase.co",
    key: "service-role-key",
    keySource: "service_role",
  });
});

test("Supabase admin config remains service-role only", () => {
  process.env.SUPABASE_URL = "https://example.supabase.co/";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  assert.deepEqual(supabaseAdminConfig(), {
    url: "https://example.supabase.co",
    key: "service-role-key",
    keySource: "service_role",
  });
});
