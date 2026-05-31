import test from "node:test";
import assert from "node:assert/strict";
import { __testables } from "../src/lib/providers/brokerage-consensus.js";

const holding = {
  companyName: "Jio Financial Services",
  symbol: "JIOFIN",
};

test("extracts rating from the clause that matches the target stock", () => {
  const item = __testables.toConsensusItem(
    {
      title:
        "Buy RBL Bank, L&T Finance shares, stay cautious on Jio Financial, suggests YES Securities - Business Today",
      source: "Business Today",
      url: "https://example.com/jio",
      publishedAt: "Fri, 16 Jan 2026 08:00:00 GMT",
    },
    holding
  );

  assert.equal(item?.broker, "Yes Securities");
  assert.equal(item?.rating, "neutral");
  assert.match(item?.matchedClause || "", /Jio Financial/i);
});

test("captures trailing broker names in target-price headlines", () => {
  const item = __testables.toConsensusItem(
    {
      title: "Buy Waaree Energies; target of Rs 4260: Emkay Global Financial - TradingView",
      source: "TradingView",
      url: "https://example.com/waaree",
      publishedAt: "Wed, 25 Feb 2026 08:00:00 GMT",
    },
    {
      companyName: "Waaree Energies",
      symbol: "WAAREEENER",
    }
  );

  assert.equal(item?.broker, "Emkay Global Financial");
  assert.equal(item?.rating, "buy");
});

test("keeps only the latest stance per broker", () => {
  const items = __testables.pickLatestByBroker([
    {
      broker: "Emkay Global Financial",
      rating: "buy",
      publishedAt: "Wed, 25 Feb 2026 08:00:00 GMT",
    },
    {
      broker: "Emkay Global Financial",
      rating: "neutral",
      publishedAt: "Fri, 27 Feb 2026 08:00:00 GMT",
    },
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0].rating, "neutral");
});
