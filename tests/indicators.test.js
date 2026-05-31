import test from "node:test";
import assert from "node:assert/strict";
import { calculateSMA, calculateVolatility } from "../src/lib/pipeline/fetch-portfolio.js";

test("calculateSMA computes average of last N candles", () => {
  const candles = Array.from({ length: 60 }, (_, i) => [null, null, null, null, i + 1]);
  const sma = calculateSMA(candles, 50);
  assert.equal(sma, 35.5);
});

test("calculateVolatility computes standard deviation of daily changes", () => {
  const candles = [
    [null, null, null, null, 100],
    [null, null, null, null, 105],
    [null, null, null, null, 100],
  ];
  const vol = calculateVolatility(candles);
  assert.equal(vol > 0, true);
});
