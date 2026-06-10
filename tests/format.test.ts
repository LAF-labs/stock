import test from "node:test";
import assert from "node:assert/strict";

import { formatDateTimeFromEpoch } from "../src/lib/format";

test("formatDateTimeFromEpoch renders deterministic Korean time without locale day periods", () => {
  const epoch = Date.UTC(2026, 5, 9, 23, 42) / 1000;

  assert.equal(formatDateTimeFromEpoch(epoch), "2026. 06. 10. 08:42");
});
