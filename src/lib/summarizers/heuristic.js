import { sentimentLabel } from "../utils.js";

function keywordScore(item) {
  const haystack = `${item.title} ${item.category}`.toLowerCase();
  let score = 0;
  if (/(profit|growth|beat|surge|order win|upgrade|dividend|record)/.test(haystack)) {
    score += 1;
  }
  if (/(fraud|downgrade|fall|probe|lawsuit|loss|miss|default|pledge)/.test(haystack)) {
    score -= 1;
  }
  if (/(promoter shareholding|investor presentation|annual report)/.test(haystack)) {
    score += 0;
  }
  return score;
}

export class HeuristicSummarizer {
  async summarize(holding, evidence) {
    const evidenceScore = evidence.reduce((sum, item) => sum + keywordScore(item), 0);
    const priceScore = holding.weeklyChangePct >= 3 ? 1 : holding.weeklyChangePct <= -3 ? -1 : 0;
    const totalScore = evidenceScore + priceScore;
    const topItems = evidence.slice(0, 5);
    const sentiment = evidence.length < 2 ? "unclear" : sentimentLabel(totalScore);

    return {
      sentiment,
      confidence: evidence.length >= 5 ? "medium" : "low",
      keyDevelopments: topItems.map((item) => `${item.title} (${item.source})`),
      whyMoving:
        evidence.length === 0
          ? "No strong public evidence was collected this week, so the move cannot be confidently explained."
          : `The recent move appears to be influenced by ${topItems
              .slice(0, 3)
              .map((item) => item.category)
              .join(", ")} signals alongside a weekly change of ${holding.weeklyChangePct.toFixed(2)}%.`,
      watchpoints:
        evidence.length < 3
          ? ["Evidence coverage is thin; verify with official exchange filings before acting."]
          : ["Track whether the latest developments show up in company filings or management commentary."],
      missingEvidence:
        evidence.length < 2
          ? ["Insufficient evidence for a confident weekly view."]
          : [],
      rationale:
        sentiment === "unclear"
          ? "Evidence is too sparse or noisy for a confident stance."
          : `A ${sentiment} stance is based on this week's evidence mix and market move, not on long-term valuation.`,
      citations: topItems.map((item) => ({
        title: item.title,
        url: item.url,
        source: item.source,
      })),
    };
  }
}
