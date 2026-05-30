import test from "node:test";
import assert from "node:assert/strict";
import { parseKiteDate } from "../src/lib/utils.js";

test("parseKiteDate parses Kite timestamps", () => {
  const parsed = parseKiteDate("2026-05-30 10:15:00");
  assert.equal(parsed?.toISOString(), "2026-05-30T04:45:00.000Z");
});
