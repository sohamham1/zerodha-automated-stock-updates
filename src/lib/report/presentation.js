import { sentimentLabel } from "../utils.js";

const ENTITY_MAP = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const MOJIBAKE_MAP = new Map([
  ["â€“", "-"],
  ["â€”", "-"],
  ["â€˜", "'"],
  ["â€™", "'"],
  ["â€œ", '"'],
  ["â€�", '"'],
  ["â€¢", "•"],
  ["â€¦", "..."],
  ["Â", ""],
  ["₹", "Rs "],
]);

const RECENT_WINDOW_DAYS = 45;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDisplayCandidate(candidate) {
  let next = cleanDisplayText(candidate)
    .replace(/'s$/i, "")
    .replace(/'+$/g, "")
    .replace(/^(the total return for|is|will weakness in|should you buy|unpleasant surprises could be in store for)\s+/i, "")
    .replace(/^individual investors own .*? of\s+/i, "")
    .replace(/^of\s+/i, "")
    .replace(/^we think that there are issues underlying\s+/i, "")
    .replace(/^a day ahead of .*?,\s+/i, "")
    .trim();
  if (/^(the|is|will|should|why)\b/i.test(next)) {
    const fragments = next.split(/\b(?:for|in|of)\b/i).map((part) => cleanDisplayText(part));
    next = fragments[fragments.length - 1] || next;
  }
  return next;
}

function cleanWhitespace(value) {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function replaceMojibake(value) {
  let next = String(value || "");
  for (const [bad, good] of MOJIBAKE_MAP.entries()) {
    next = next.replaceAll(bad, good);
  }
  return next;
}

export function decodeHtmlEntities(value) {
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (/^#x/i.test(entity)) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (/^#/i.test(entity)) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return ENTITY_MAP[entity.toLowerCase()] ?? match;
  });
}

export function cleanDisplayText(value) {
  return cleanWhitespace(replaceMojibake(decodeHtmlEntities(value)));
}

export function cleanTicker(value) {
  return cleanDisplayText(value).replace(/\s+/g, "");
}

export function parsePublishedAt(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

export function formatEvidenceDate(value) {
  const parsed = value instanceof Date ? value : parsePublishedAt(value);
  if (!parsed) {
    return "Date unavailable";
  }
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function titleCaseFallback(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function extractDisplayNameFromEvidence(evidence, symbol) {
  const escapedSymbol = escapeRegex(symbol);
  const patterns = [
    new RegExp(`([A-Za-z0-9&.,'\\- ]+?)\\s*\\((?:NSE|BSE):${escapedSymbol}\\)`, "i"),
    new RegExp(`([A-Za-z0-9&.,'\\- ]+?)\\s*\\((?:${escapedSymbol})\\)`, "i"),
  ];

  for (const item of evidence) {
    const title = cleanDisplayText(item?.title || "");
    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (!match?.[1]) {
        continue;
      }
      const candidate = normalizeDisplayCandidate(match[1]);
      if (candidate && candidate.length >= 4) {
        return candidate;
      }
    }
  }

  return "";
}

export function deriveDisplayName(holding, evidence = []) {
  const companyName = cleanDisplayText(holding?.companyName || "");
  const ticker = cleanTicker(holding?.symbol || "");
  const fromEvidence = extractDisplayNameFromEvidence(evidence, ticker);
  if (fromEvidence) {
    return fromEvidence;
  }
  if (companyName && companyName !== ticker && /\s/.test(companyName)) {
    return companyName;
  }
  if (companyName && companyName !== ticker && /[a-z]/i.test(companyName)) {
    return titleCaseFallback(companyName);
  }
  return titleCaseFallback(ticker);
}

function evidenceRelevanceScore(item) {
  const haystack = cleanDisplayText(`${item?.title || ""} ${item?.category || ""}`).toLowerCase();
  let score = 0;
  if (/(profit|growth|beat|surge|order win|upgrade|dividend|record|expansion|target|results|earnings)/.test(haystack)) {
    score += 2;
  }
  if (/(broker|buy|neutral|sell|target price)/.test(haystack)) {
    score += 1;
  }
  if (/(fraud|downgrade|fall|probe|lawsuit|loss|miss|default|pledge|resigns|slips|tumbled|weakness)/.test(haystack)) {
    score += 1;
  }
  return score;
}

function freshnessBucket(publishedAt, reportDate) {
  const parsed = parsePublishedAt(publishedAt);
  if (!parsed) {
    return "stale";
  }
  const ageDays = Math.floor((reportDate.valueOf() - parsed.valueOf()) / MS_PER_DAY);
  return ageDays <= RECENT_WINDOW_DAYS ? "recent" : "stale";
}

export function normalizeEvidenceItems(items = [], reportDateInput = new Date()) {
  const reportDate = reportDateInput instanceof Date ? reportDateInput : new Date(reportDateInput);
  return items
    .map((item) => {
      const publishedDate = parsePublishedAt(item?.publishedAt);
      const publishedAtLabel = formatEvidenceDate(publishedDate);
      const freshness = freshnessBucket(publishedDate, reportDate);
      return {
        ...item,
        category: cleanDisplayText(item?.category || ""),
        source: cleanDisplayText(item?.source || "Unknown source"),
        title: cleanDisplayText(item?.title || "Untitled source"),
        url: cleanDisplayText(item?.url || ""),
        publishedAt: item?.publishedAt || null,
        publishedAtLabel,
        freshness,
        relevanceScore: evidenceRelevanceScore(item),
        publishedAtTs: publishedDate?.valueOf() ?? 0,
      };
    })
    .sort((left, right) => {
      const freshnessDelta =
        (left.freshness === "recent" ? 1 : 0) - (right.freshness === "recent" ? 1 : 0);
      if (freshnessDelta !== 0) {
        return freshnessDelta * -1;
      }
      if (left.publishedAtTs !== right.publishedAtTs) {
        return right.publishedAtTs - left.publishedAtTs;
      }
      if (left.relevanceScore !== right.relevanceScore) {
        return right.relevanceScore - left.relevanceScore;
      }
      return left.title.localeCompare(right.title);
    });
}

export function normalizeBrokerageConsensus(consensus = {}, reportDateInput = new Date()) {
  const items = normalizeEvidenceItems(consensus.items || [], reportDateInput).map((item) => ({
    ...item,
    broker: cleanDisplayText(item?.broker || item?.source || "Unknown broker"),
    rating: cleanDisplayText(item?.rating || "").toLowerCase(),
    matchedClause: cleanDisplayText(item?.matchedClause || ""),
  }));
  const next = {
    ...consensus,
    buy: Number(consensus.buy || 0),
    neutral: Number(consensus.neutral ?? consensus.hold ?? 0),
    sell: Number(consensus.sell || 0),
    scannedCount: Number(consensus.scannedCount || 0),
    coverageNote: cleanDisplayText(consensus.coverageNote || ""),
    items,
  };
  delete next.hold;
  return next;
}

function performanceScore(holding) {
  const returnPct = Number(holding.returnPct ?? 0);
  const weeklyChange = Number(holding.weeklyChangePct ?? 0);
  let score = 0;
  if (returnPct <= -35) {
    score -= 2;
  } else if (returnPct <= -15) {
    score -= 1;
  } else if (returnPct >= 50) {
    score += 2;
  } else if (returnPct >= 15) {
    score += 1;
  }
  if (weeklyChange <= -3) {
    score -= 1;
  } else if (weeklyChange >= 3) {
    score += 1;
  }
  return score;
}

function trendScore(holding) {
  const trends = holding.trends || {};
  const sma50 = Number(trends.sma50);
  const rsi14 = Number(trends.rsi14);
  const lastPrice = Number(holding.lastPrice);
  let score = 0;
  if (Number.isFinite(sma50) && Number.isFinite(lastPrice)) {
    score += lastPrice >= sma50 ? 1 : -1;
  }
  if (Number.isFinite(rsi14)) {
    if (rsi14 >= 70 || rsi14 <= 40) {
      score -= 1;
    } else if (rsi14 >= 45 && rsi14 <= 65) {
      score += 1;
    }
  }
  return score;
}

function brokerScore(holding) {
  const consensus = holding.brokerageConsensus || {};
  const scanned = consensus.scannedCount || 0;
  if (!scanned) {
    return 0;
  }
  const buy = consensus.buy || 0;
  const neutral = consensus.neutral || 0;
  const sell = consensus.sell || 0;
  if (sell > buy) {
    return -1;
  }
  if (buy > sell && buy >= neutral) {
    return 1;
  }
  return 0;
}

function dominantEvidenceCategories(evidence) {
  const counts = new Map();
  for (const item of evidence) {
    const key = cleanDisplayText(item.category || "company updates").toLowerCase() || "company updates";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([category]) => category);
}

function categorizeCoverage(evidence, consensus) {
  const recentCount = evidence.filter((item) => item.freshness === "recent").length;
  const brokerCount = Number(consensus?.scannedCount || 0);
  if (recentCount >= 4 || brokerCount >= 4) {
    return {
      confidence: "high",
      confidenceReason: "Confidence is high because the view is backed by multiple recent sources and/or meaningful external coverage.",
    };
  }
  if (recentCount >= 2 || brokerCount >= 2) {
    return {
      confidence: "medium",
      confidenceReason: "Confidence is medium because there is some recent evidence, but coverage is still partial.",
    };
  }
  return {
    confidence: "low",
    confidenceReason: "Confidence is low because evidence is sparse, stale, or supported by very limited broker coverage.",
  };
}

function buildWhyMoving(holding, evidence, consensus) {
  const recentEvidence = evidence.filter((item) => item.freshness === "recent");
  const categories = dominantEvidenceCategories(recentEvidence.length ? recentEvidence : evidence);
  const weeklyChange = Number(holding.weeklyChangePct ?? 0);
  const moveDescriptor =
    weeklyChange >= 2 ? "a strong positive weekly move" :
    weeklyChange <= -2 ? "a notable weekly pullback" :
    "a relatively muted weekly move";
  const price = Number(holding.lastPrice);
  const sma50 = Number(holding.trends?.sma50);
  const trendPhrase = Number.isFinite(price) && Number.isFinite(sma50)
    ? (price >= sma50 ? "price is still above the 50-day SMA" : "price remains below the 50-day SMA")
    : "trend context is limited because the 50-day SMA was not available";

  const parts = [`This week's move looks tied to ${moveDescriptor}`];
  if (categories.length) {
    parts.push(`with the clearest signals coming from ${categories.join(" and ")} updates`);
  }
  parts.push(trendPhrase);
  if ((consensus?.scannedCount || 0) >= 2) {
    parts.push(`and broker coverage currently leans Buy ${consensus.buy} / Neutral ${consensus.neutral} / Sell ${consensus.sell}`);
  }
  return `${parts.join(", ")}.`;
}

function buildRationale(holding, sentiment, consensus) {
  const reasons = [];
  const returnPct = Number(holding.returnPct ?? 0);
  if (returnPct <= -15) {
    reasons.push(`all-time return remains weak at ${returnPct.toFixed(2)}%`);
  } else if (returnPct >= 15) {
    reasons.push(`all-time return remains strong at ${returnPct.toFixed(2)}%`);
  }

  const sma50 = Number(holding.trends?.sma50);
  const lastPrice = Number(holding.lastPrice);
  if (Number.isFinite(sma50) && Number.isFinite(lastPrice)) {
    reasons.push(lastPrice >= sma50 ? "price is above the 50-day SMA" : "price is below the 50-day SMA");
  }

  if ((consensus?.scannedCount || 0) >= 2) {
    reasons.push(`broker coverage reads Buy ${consensus.buy} / Neutral ${consensus.neutral} / Sell ${consensus.sell}`);
  } else {
    reasons.push("external broker coverage is still thin");
  }

  const prefix = sentiment === "unclear" ? "Unclear because" : `${sentiment.charAt(0).toUpperCase() + sentiment.slice(1)} because`;
  return `${prefix} ${reasons.join(", ")}.`;
}

function buildMissingEvidence(evidence, consensus) {
  const items = [];
  const recentCount = evidence.filter((item) => item.freshness === "recent").length;
  if (recentCount < 2) {
    items.push("Recent public evidence is thin, so the weekly angle is only partially supported.");
  }
  if (evidence.some((item) => item.freshness === "stale")) {
    items.push("Some supporting references are older and should be treated as background, not fresh confirmation.");
  }
  if ((consensus?.scannedCount || 0) < 2) {
    items.push("Broker coverage is limited, so consensus signals are incomplete.");
  }
  return items;
}

function buildWatchpoints(holding, evidence, consensus) {
  const points = [];
  const returnPct = Number(holding.returnPct ?? 0);
  const weight = Number(holding.portfolioWeight ?? 0);
  if (weight >= 25) {
    points.push("Portfolio concentration is high here, so position sizing matters more than normal.");
  }
  if (returnPct <= -20) {
    points.push("The position is still well below cost, so thesis validation matters more than headline noise.");
  }
  if (Number(holding.weeklyChangePct ?? 0) <= -3) {
    points.push("The recent weekly drop deserves a follow-up check against filings, management commentary, or sector news.");
  }
  if ((consensus?.scannedCount || 0) < 2) {
    points.push("Independent broker confirmation is limited, so treat outside consensus as directional only.");
  }
  if (!points.length && evidence.length) {
    points.push("Track whether the latest evidence continues to show up in filings, management commentary, or broker follow-ups.");
  }
  return points;
}

function pickKeyDevelopments(rawSummary, evidence) {
  const explicit = (rawSummary?.keyDevelopments || [])
    .map((item) => cleanDisplayText(item))
    .filter(Boolean);
  if (explicit.length) {
    return explicit.slice(0, 4);
  }
  return evidence.slice(0, 4).map((item) => `${item.title} (${item.source})`);
}

export function selectTopCitations(evidence, limit = 3) {
  const recent = evidence.filter((item) => item.freshness === "recent");
  const stale = evidence.filter((item) => item.freshness !== "recent");
  const selected = recent.slice(0, limit);
  if (selected.length < limit) {
    selected.push(
      ...stale.slice(0, limit - selected.length).map((item) => ({
        ...item,
        freshness: "fallback",
      }))
    );
  }
  return selected.map((item) => ({
    title: item.title,
    url: item.url,
    source: item.source,
    publishedAt: item.publishedAt || null,
    publishedAtLabel: item.publishedAtLabel,
    freshness: item.freshness,
  }));
}

export function finalizeHoldingSummary({ holding, evidence, rawSummary = null, reportDate }) {
  const totalScore =
    performanceScore(holding) +
    trendScore(holding) +
    brokerScore(holding) +
    evidence.reduce((sum, item) => sum + item.relevanceScore, 0);
  const evidenceScore = evidence.reduce((sum, item) => sum + item.relevanceScore, 0);

  let sentiment = cleanDisplayText(rawSummary?.sentiment || "").toLowerCase();
  if (!["bullish", "neutral", "cautious", "unclear"].includes(sentiment)) {
    if (evidence.filter((item) => item.freshness === "recent").length < 2 && Math.abs(totalScore) < 2) {
      sentiment = "unclear";
    } else if (Number(holding.returnPct ?? 0) <= -20 && (Number(holding.weeklyChangePct ?? 0) < 0 || trendScore(holding) <= 0)) {
      sentiment = "cautious";
    } else if (Number(holding.returnPct ?? 0) >= 40 && totalScore >= 1) {
      sentiment = "bullish";
    } else if (evidenceScore <= -2 && totalScore <= 0) {
      sentiment = "cautious";
    } else {
      sentiment = sentimentLabel(totalScore);
    }
  }

  const confidenceState = categorizeCoverage(evidence, holding.brokerageConsensus);
  const whyMoving = buildWhyMoving(holding, evidence, holding.brokerageConsensus);
  const missingEvidence = buildMissingEvidence(evidence, holding.brokerageConsensus);
  const watchpoints = buildWatchpoints(holding, evidence, holding.brokerageConsensus);
  const citations = selectTopCitations(evidence, 3);

  return {
    sentiment,
    confidence: confidenceState.confidence,
    confidenceReason: confidenceState.confidenceReason,
    keyDevelopments: pickKeyDevelopments(rawSummary, evidence),
    whyMoving,
    watchpoints,
    missingEvidence,
    rationale: buildRationale(holding, sentiment, holding.brokerageConsensus),
    citations,
    updatedAt: reportDate.toISOString(),
  };
}

export function buildHoldingPresentation(holding, evidence, reportDateInput = new Date()) {
  const reportDate = reportDateInput instanceof Date ? reportDateInput : new Date(reportDateInput);
  const ticker = cleanTicker(holding.symbol || holding.tradingsymbol || "");
  const displayName = deriveDisplayName(holding, evidence);
  return {
    ...holding,
    symbol: ticker,
    ticker,
    displayName,
    exchangeLabel: cleanDisplayText(holding.exchange || ""),
    companyName: cleanDisplayText(holding.companyName || displayName),
    asOfDate: reportDate.toISOString().slice(0, 10),
  };
}
