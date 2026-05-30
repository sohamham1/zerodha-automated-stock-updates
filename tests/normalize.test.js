import test from "node:test";
import assert from "node:assert/strict";
import { applyPortfolioWeights, normalizeHolding } from "../src/lib/portfolio/normalize.js";

test("normalizeHolding maps common Kite fields", () => {
  const item = normalizeHolding({
    tradingsymbol: "INFY",
    exchange: "NSE",
    isin: "INE009A01021",
    quantity: 10,
    average_price: 1500,
    last_price: 1600,
  });

  assert.equal(item.symbol, "INFY");
  assert.equal(item.exchange, "NSE");
  assert.equal(item.currentValue, 16000);
  assert.equal(item.investedValue, 15000);
});

test("applyPortfolioWeights allocates weights by current value", () => {
  const holdings = applyPortfolioWeights([
    { symbol: "A", currentValue: 250 },
    { symbol: "B", currentValue: 750 },
  ]);

  assert.equal(holdings[0].portfolioWeight, 25);
  assert.equal(holdings[1].portfolioWeight, 75);
});
