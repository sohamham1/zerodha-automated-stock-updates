import { dedupeBy, slugify } from "../utils.js";
import { cleanDisplayText } from "../report/presentation.js";

const BROKER_LOOKBACK_DAYS = 30;

const BROKER_QUERY_TEMPLATES = [
  ({ companyName, symbol }) => `"${companyName}" "${symbol}" target price broker`,
  ({ companyName, symbol }) => `"${companyName}" "${symbol}" buy hold sell analyst`,
  ({ companyName, symbol }) => `"${companyName}" "${symbol}" brokerage recommendation India`,
];

const BROKER_HINTS = [
  "motilal oswal",
  "icici securities",
  "hdfc securities",
  "hdfc sky",
  "nuvama",
  "antique",
  "jefferies",
  "jm financial",
  "axis securities",
  "kotak institutional equities",
  "kotak securities",
  "emkay global financial",
  "emkay",
  "prabhudas lilladher",
  "choice broking",
  "geojit",
  "yes securities",
  "incred",
  "bernstein",
  "goldman sachs",
  "morgan stanley",
  "nomura",
  "jpmorgan",
  "citi",
  "hsbc",
  "macquarie",
  "phillipcapital",
  "sharekhan",
  "ventura",
  "sbi securities",
];

const RATING_PATTERNS = [
  { pattern: /\bstrong buy\b|\bbuy\b|\baccumulate\b|\boutperform\b|\boverweight\b/i, value: "buy" },
  { pattern: /\bhold\b|\bneutral\b|\bmarket perform\b|\bequal weight\b|\bcautious\b/i, value: "neutral" },
  { pattern: /\bsell\b|\breduce\b|\bunderperform\b|\bunderweight\b|\bavoid\b/i, value: "sell" },
];

const EXCLUDED_SOURCES = new Set([
  "simplywall.st",
  "stockinvest.us",
  "equitypandit",
  "markets mojo",
  "marketsmojo",
  "upstox",
  "mint",
]);

function extractTag(block, tagName) {
  const match = block.match(
    new RegExp(`<${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)</${tagName}>`, "i")
  );
  return match ? cleanDisplayText(match[1].replace(/^<!\[CDATA\[(.*)\]\]>$/s, "$1").trim()) : "";
}

function parseRss(xml) {
  const items = [];
  const matches = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  for (const itemXml of matches) {
    const title = extractTag(itemXml, "title");
    const link = extractTag(itemXml, "link");
    const pubDate = extractTag(itemXml, "pubDate");
    const source = extractTag(itemXml, "source");
    if (!title || !link) {
      continue;
    }
    items.push({
      id: slugify(`${title}-${link}`),
      title,
      url: cleanDisplayText(link),
      source: source || "Google News",
      publishedAt: pubDate || null,
    });
  }
  return items;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAliasesFromSeedItems(symbol, items = []) {
  const aliases = new Set();
  const escapedSymbol = String(symbol || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`([A-Za-z0-9&.,'\\- ]+?)\\s*\\((?:NSE|BSE):${escapedSymbol}\\)`, "i"),
    new RegExp(`([A-Za-z0-9&.,'\\- ]+?)\\s*\\((?:${escapedSymbol})\\)`, "i"),
  ];

  for (const item of items) {
    const title = cleanDisplayText(item?.title || "");
    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (!match?.[1]) {
        continue;
      }
      const candidate = normalizeText(match[1].replace(/'s$/i, "").trim());
      if (candidate && candidate.length >= 3) {
        aliases.add(candidate);
        const words = candidate.split(" ").filter(Boolean);
        if (words.length >= 2) {
          aliases.add(words.slice(0, 2).join(" "));
        }
        if (words.length >= 3) {
          aliases.add(words.slice(0, 3).join(" "));
        }
      }
    }
  }

  return aliases;
}

function extractCompanyAliases(holding, seedItems = []) {
  const raw = [
    holding.companyName,
    holding.displayName,
    holding.symbol,
    holding.symbol?.replace(/&/g, " and "),
  ].filter(Boolean);
  const aliases = new Set();

  for (const item of raw) {
    const normalized = normalizeText(item);
    if (!normalized) {
      continue;
    }
    aliases.add(normalized);
    const words = normalized.split(" ").filter(Boolean);
    if (words.length >= 2) {
      aliases.add(words.slice(0, 2).join(" "));
    }
    if (words.length >= 3) {
      aliases.add(words.slice(0, 3).join(" "));
    }
  }

  for (const alias of extractAliasesFromSeedItems(holding.symbol, seedItems)) {
    aliases.add(alias);
  }

  return [...aliases].filter((alias) => alias.length >= 3);
}

function titleMentionsHolding(title, aliases) {
  const normalizedTitle = normalizeText(title);
  return aliases.some((alias) => normalizedTitle.includes(alias));
}

function extractRelevantClause(title, aliases) {
  const titleWithoutSource = String(title || "").split(" - ")[0];
  const normalizedFull = normalizeText(titleWithoutSource);
  const clauses = titleWithoutSource
    .split(/[:;|,]/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const normalizedClause = normalizeText(clause);
    if (aliases.some((alias) => normalizedClause.includes(alias))) {
      return clause;
    }
  }

  return aliases.some((alias) => normalizedFull.includes(alias)) ? titleWithoutSource : "";
}

function extractBroker(title) {
  const lower = title.toLowerCase();
  for (const broker of BROKER_HINTS) {
    if (lower.includes(broker)) {
      return broker
        .split(" ")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    }
  }

  const brokerSuffixMatch = title.match(/:\s*([^:]+?)\s*-\s*[^-]+$/i);
  if (brokerSuffixMatch) {
    return brokerSuffixMatch[1].trim();
  }

  const maintainMatch = title.match(/^(.+?)\s+(?:maintains?|reiterates?|initiates?|upgrades?|downgrades?)\b/i);
  if (maintainMatch) {
    return maintainMatch[1].trim();
  }
  return null;
}

function extractRating(text) {
  for (const rule of RATING_PATTERNS) {
    if (rule.pattern.test(text)) {
      return rule.value;
    }
  }
  return null;
}

function shouldExcludeBySource(item) {
  const source = normalizeText(item.source);
  return EXCLUDED_SOURCES.has(source);
}

function toConsensusItem(item, holding, aliases = extractCompanyAliases(holding)) {
  const relevantClause = extractRelevantClause(item.title, aliases);
  if (!relevantClause) {
    return null;
  }

  const broker = extractBroker(item.title);
  if (!broker) {
    return null;
  }

  const rating = extractRating(relevantClause) || extractRating(item.title);
  if (!rating) {
    return null;
  }

  if (shouldExcludeBySource(item) && !broker) {
    return null;
  }

  return {
    ...item,
    broker: cleanDisplayText(broker),
    rating,
    matchedClause: cleanDisplayText(relevantClause),
  };
}

function isWithinLookbackWindow(item, lookbackDays = BROKER_LOOKBACK_DAYS) {
  const publishedAtMs = Date.parse(item?.publishedAt || "");
  if (!publishedAtMs) {
    return false;
  }
  const ageMs = Date.now() - publishedAtMs;
  return ageMs >= 0 && ageMs <= lookbackDays * 24 * 60 * 60 * 1000;
}

function buildCoverageNote(count) {
  if (count >= 5) {
    return `Coverage was built from ${count} publicly visible brokerage recommendation items from the last ${BROKER_LOOKBACK_DAYS} days.`;
  }
  if (count >= 2) {
    return `Only a small number of clearly attributable brokerage notes were visible in the last ${BROKER_LOOKBACK_DAYS} days, so the consensus should be read as directional rather than comprehensive.`;
  }
  if (count === 1) {
    return `Only one clearly attributable brokerage note was visible in the last ${BROKER_LOOKBACK_DAYS} days, so this should be treated as a light outside signal rather than a firm consensus.`;
  }
  return `No clearly attributable brokerage recommendation items were surfaced in the last ${BROKER_LOOKBACK_DAYS} days, so this section relies more on price action and other public evidence than on broker consensus.`;
}

async function fetchGoogleNewsQuery(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=en-IN&gl=IN&ceid=IN:en`;

  const response = await fetch(url, {
    headers: {
      "user-agent": "portfolio-intelligence-reporter/0.1",
    },
  });

  if (!response.ok) {
    return [];
  }

  const xml = await response.text();
  return parseRss(xml);
}

function pickLatestByBroker(items) {
  const byBroker = new Map();
  for (const item of items) {
    const key = normalizeText(item.broker);
    const existing = byBroker.get(key);
    const currentTime = Date.parse(item.publishedAt || "") || 0;
    const existingTime = Date.parse(existing?.publishedAt || "") || 0;
    if (!existing || currentTime >= existingTime) {
      byBroker.set(key, item);
    }
  }
  return [...byBroker.values()];
}

export class BrokerageConsensusProvider {
  async fetchForHolding(holding, seedItems = []) {
    const queryItems = await Promise.all(
      BROKER_QUERY_TEMPLATES.map((buildQuery) =>
        fetchGoogleNewsQuery(buildQuery(holding)).catch(() => [])
      )
    );

    const combinedItems = dedupeBy(
      [...seedItems, ...queryItems.flat()],
      (item) => item.url || item.id || item.title
    );
    const aliases = extractCompanyAliases(holding, combinedItems);

    const parsedItems = combinedItems
      .map((item) => toConsensusItem(item, holding, aliases))
      .filter(Boolean)
      .filter((item) => isWithinLookbackWindow(item))
      .filter(Boolean);

    const uniqueByBroker = pickLatestByBroker(parsedItems);
    const counts = {
      buy: 0,
      neutral: 0,
      sell: 0,
    };

    for (const item of uniqueByBroker) {
      counts[item.rating] += 1;
    }

    const coverageNote = buildCoverageNote(uniqueByBroker.length);

    return {
      scannedCount: uniqueByBroker.length,
      ...counts,
      coverageNote,
      items: uniqueByBroker,
    };
  }
}

export const __testables = {
  BROKER_LOOKBACK_DAYS,
  extractCompanyAliases,
  extractRelevantClause,
  extractBroker,
  isWithinLookbackWindow,
  extractRating,
  toConsensusItem,
  pickLatestByBroker,
};
