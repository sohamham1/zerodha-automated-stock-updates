import test from "node:test";
import assert from "node:assert/strict";
import { buildMarkdownReport } from "../src/lib/report/markdown.js";

test("buildMarkdownReport includes stock sentiment and sources", () => {
  const markdown = buildMarkdownReport({
    generatedAt: "2026-05-30T12:00:00.000Z",
    period: "weekly",
    summary: {
      holdingsCount: 1,
      totalValue: 1000,
      totalPnl: 100,
      sentimentCounts: {
        bullish: 1,
        neutral: 0,
        cautious: 0,
        unclear: 0,
      },
    },
    holdings: [
      {
        companyName: "Infosys",
        exchange: "NSE",
        symbol: "INFY",
        quantity: 10,
        averagePrice: 90,
        lastPrice: 100,
        currentValue: 1000,
        portfolioWeight: 100,
        weeklyChangePct: 2,
        summary: {
          sentiment: "bullish",
          confidence: "medium",
          keyDevelopments: ["Dividend declared"],
          whyMoving: "Positive cash-return signal.",
          watchpoints: ["Track the next quarterly filing."],
          missingEvidence: [],
          rationale: "Signals were positive overall.",
          citations: [
            {
              title: "Dividend declared",
              url: "https://example.com/news",
              source: "Example News",
            },
          ],
        },
      },
    ],
  });

  assert.match(markdown, /Sentiment: bullish/);
  assert.match(markdown, /Dividend declared/);
  assert.match(markdown, /\[Dividend declared\]\(https:\/\/example\.com\/news\)/);
});
