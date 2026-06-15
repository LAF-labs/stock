import assert from "node:assert/strict";
import test from "node:test";

import {
  adminCredentialsAreValid,
  createAdminSessionToken,
  verifyAdminSessionToken,
} from "../src/lib/adminAuth";

test("admin auth accepts only the single server-side account", () => {
  assert.equal(adminCredentialsAreValid("once0811", "myonce0811"), true);
  assert.equal(adminCredentialsAreValid("once0811", "wrong"), false);
  assert.equal(adminCredentialsAreValid("other", "myonce0811"), false);
});

test("admin session tokens verify until expiry", () => {
  const now = new Date("2026-06-16T00:00:00.000Z");
  const token = createAdminSessionToken(now, "test-secret");

  assert.equal(verifyAdminSessionToken(token, new Date("2026-06-16T11:59:59.000Z"), "test-secret"), true);
  assert.equal(verifyAdminSessionToken(token, new Date("2026-06-16T12:00:01.000Z"), "test-secret"), false);
  assert.equal(verifyAdminSessionToken(`${token}x`, now, "test-secret"), false);
});
