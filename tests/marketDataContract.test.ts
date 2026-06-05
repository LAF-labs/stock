import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonObject = Record<string, unknown>;

const fixtureDir = join(process.cwd(), "tests", "fixtures", "market-data");

function loadFixture(name: string): JsonObject {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as JsonObject;
}

function assertObject(value: unknown, message: string): asserts value is JsonObject {
  assert.equal(typeof value, "object", message);
  assert.notEqual(value, null, message);
  assert.equal(Array.isArray(value), false, message);
}

function assertRequiredString(payload: JsonObject, key: string) {
  assert.equal(typeof payload[key], "string", `${key} must be a string`);
  assert.notEqual(String(payload[key]).trim(), "", `${key} must not be empty`);
}

function assertRequiredNumber(payload: JsonObject, key: string) {
  assert.equal(typeof payload[key], "number", `${key} must be a number`);
  assert.equal(Number.isFinite(payload[key] as number), true, `${key} must be finite`);
}

function assertPublicMarketDataFields(payload: JsonObject) {
  assert.equal(payload.ok, true);
  assertRequiredString(payload, "market");
  assertRequiredString(payload, "symbol");
  assertRequiredString(payload, "name");
  assertRequiredNumber(payload, "latest_price");
  assertObject(payload.price_metrics, "price_metrics must be an object");
  assertObject(payload.server_cache, "server_cache must be an object");
}

function assertScoreFields(payload: JsonObject) {
  assertPublicMarketDataFields(payload);
  assertRequiredNumber(payload, "score");
  assert.equal(Array.isArray(payload.components), true, "components must be an array");
  assert.equal(Array.isArray(payload.key_metrics), true, "key_metrics must be an array");
  assert.equal(Array.isArray(payload.chart_series), true, "chart_series must be an array");
  assertObject(payload.sia_snapshot, "sia_snapshot must be an object");
}

test("US quote response keeps public market-data contract", () => {
  assertPublicMarketDataFields(loadFixture("quote-us-ko.json"));
});

test("US detail score response keeps public score contract", () => {
  assertScoreFields(loadFixture("score-us-ko-detail.json"));
});

test("KR detail score response keeps public score contract", () => {
  assertScoreFields(loadFixture("score-kr-005930-detail.json"));
});

test("manual refresh payload keeps cooldown contract", () => {
  const payload = loadFixture("quote-us-ko-refresh.json");
  assertObject(payload.refresh_cooldown, "refresh_cooldown must be present on refresh responses");
  assertRequiredNumber(payload.refresh_cooldown, "seconds");
  assertRequiredString(payload.refresh_cooldown, "next_allowed_at");
});

test("AI judgment payload keeps six-hour cache metadata", () => {
  const payload = loadFixture("judgment-us-ko.json");
  assertRequiredString(payload, "headline");
  assertRequiredString(payload, "body");
  assertRequiredString(payload, "watch");
  assert.equal(["positive", "neutral", "cautious"].includes(String(payload.tone)), true);
  assertRequiredString(payload, "model");
  assertRequiredString(payload, "promptVersion");
  assert.equal(payload.cached, true, "cached judgments must be marked");
  assertRequiredString(payload, "cacheBucketStart");
});
