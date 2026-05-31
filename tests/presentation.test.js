import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHoldingPresentation,
  cleanDisplayText,
  finalizeHoldingSummary,
  normalizeEvidenceItems,
} from "../src/lib/report/presentation.js";

test("cleanDisplayText decodes entities and strips mojibake", () => {
  assert.equal(cleanDisplayText("ARE&amp;M"), "ARE&M");
  assert.equal(cleanDisplayText("May 25, 2026 â€“ May 29, 2026"), "May 25, 2026 - May 29, 2026");
});

test("normalizeEvidenceItems prefers recent evidence and tags freshness", () => {
  const reportDate = new Date("2026-05-31T00:00:00.000Z");
  const items = normalizeEvidenceItems(
    [
      {
        title: "Older item",
        source: "Source A",
        category: "general",
        url: "https://example.com/old",
        publishedAt: "Tue, 20 Jan 2026 08:00:00 GMT",
      },
      {
        title: "Recent item",
        source: "Source B",
        category: "results",
        url: "https://example.com/recent",
        publishedAt: "Fri, 30 May 2026 08:00:00 GMT",
      },
    ],
    reportDate
  );

  assert.equal(items[0].title, "Recent item");
  assert.equal(items[0].freshness, "recent");
  assert.equal(items[1].freshness, "stale");
  assert.match(items[0].publishedAtLabel, /May|30/);
});

test("finalizeHoldingSummary builds specific narratives and honest evidence gaps", () => {
  const reportDate = new Date("2026-05-31T00:00:00.000Z");
  const evidence = normalizeEvidenceItems(
    [
      {
        title: "Amara Raja Energy & Mobility Limited (NSE:ARE&M) shares fall after weak quarter",
        source: "Business Example",
        category: "results",
        url: "https://example.com/results",
        publishedAt: "Wed, 28 May 2026 08:00:00 GMT",
      },
      {
        title: "Amara Raja Energy & Mobility Limited (NSE:ARE&M) long-term outlook",
        source: "Research Example",
        category: "general",
        url: "https://example.com/old-note",
        publishedAt: "Mon, 20 Jan 2025 08:00:00 GMT",
      },
    ],
    reportDate
  );
  const holding = buildHoldingPresentation(
    {
      symbol: "ARE&M",
      companyName: "ARE&M",
      exchange: "BSE",
      averagePrice: 1683,
      lastPrice: 886.55,
      currentValue: 4432.75,
      pnl: -3982.25,
      returnPct: -47.32,
      weeklyChangePct: -2.14,
      portfolioWeight: 7.66,
      trends: { sma50: 950, rsi14: 43 },
      brokerageConsensus: { scannedCount: 0, buy: 0, neutral: 0, sell: 0 },
    },
    evidence,
    reportDate
  );
  holding.brokerageConsensus = { scannedCount: 0, buy: 0, neutral: 0, sell: 0 };

  const summary = finalizeHoldingSummary({
    holding,
    evidence,
    rawSummary: null,
    reportDate,
  });

  assert.equal(holding.displayName, "Amara Raja Energy & Mobility Limited");
  assert.match(summary.rationale, /^Cautious because /);
  assert.doesNotMatch(summary.whyMoving, /general, general, general/);
  assert.equal(summary.confidence, "low");
  assert.ok(summary.confidenceReason.length > 0);
  assert.ok(summary.missingEvidence.length >= 2);
  assert.ok(summary.citations.length >= 1);
  assert.equal(summary.citations[0].freshness, "recent");
});
