import { dedupeBy, slugify } from "../utils.js";

const BROKER_QUERY = ({ companyName, symbol }) =>
  `"${companyName}" OR "${symbol}" brokerage target buy hold sell India`;

const BROKER_HINTS = [
  "motilal oswal",
  "icici securities",
  "hdfc securities",
  "nuvama",
  "antique",
  "jefferies",
  "jm financial",
  "axis securities",
  "kotak institutional equities",
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

const RATING_MAP = [
  { pattern: /\bstrong buy\b|\bbuy\b|\baccumulate\b|\boutperform\b|\boverweight\b/i, value: "buy" },
  { pattern: /\bhold\b|\bneutral\b|\bmarket perform\b|\bequal weight\b/i, value: "hold" },
  { pattern: /\bsell\b|\breduce\b|\bunderperform\b|\bunderweight\b/i, value: "sell" },
];

function xmlDecode(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function extractTag(block, tagName) {
  const match = block.match(
    new RegExp(`<${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)</${tagName}>`, "i")
  );
  return match ? xmlDecode(match[1].replace(/^<!\[CDATA\[(.*)\]\]>$/s, "$1").trim()) : "";
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
      url: link,
      source: source || "Google News",
      publishedAt: pubDate || null,
    });
  }
  return items;
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

  const maintainMatch = title.match(/^(.+?)\s+(?:maintains?|reiterates?|initiates?|upgrades?|downgrades?)\b/i);
  if (maintainMatch) {
    return maintainMatch[1].trim();
  }
  return null;
}

function extractRating(title) {
  for (const rule of RATING_MAP) {
    if (rule.pattern.test(title)) {
      return rule.value;
    }
  }
  return null;
}

export class BrokerageConsensusProvider {
  async fetchForHolding(holding) {
    const query = BROKER_QUERY(holding);
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
      query
    )}&hl=en-IN&gl=IN&ceid=IN:en`;

    const response = await fetch(url, {
      headers: {
        "user-agent": "portfolio-intelligence-reporter/0.1",
      },
    });

    if (!response.ok) {
      return {
        scannedCount: 0,
        buy: 0,
        hold: 0,
        sell: 0,
        coverageNote: "No brokerage-consensus coverage could be fetched from public sources.",
        items: [],
      };
    }

    const xml = await response.text();
    const items = dedupeBy(parseRss(xml), (item) => item.url)
      .map((item) => ({
        ...item,
        broker: extractBroker(item.title),
        rating: extractRating(item.title),
      }))
      .filter((item) => item.broker && item.rating);

    const uniqueByBroker = dedupeBy(items, (item) => `${item.broker}-${item.rating}`);
    const counts = {
      buy: 0,
      hold: 0,
      sell: 0,
    };

    for (const item of uniqueByBroker) {
      counts[item.rating] += 1;
    }

    const coverageNote =
      uniqueByBroker.length >= 5
        ? `Coverage was built from ${uniqueByBroker.length} publicly visible brokerage recommendation items for Indian equities.`
        : `Limited brokerage coverage: only ${uniqueByBroker.length} public recommendation items were identified, so the consensus may be incomplete.`;

    return {
      scannedCount: uniqueByBroker.length,
      ...counts,
      coverageNote,
      items: uniqueByBroker,
    };
  }
}
