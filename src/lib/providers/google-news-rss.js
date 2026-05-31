import { dedupeBy, slugify } from "../utils.js";
import { cleanDisplayText } from "../report/presentation.js";

const QUERY_TEMPLATES = {
  general: ({ companyName, symbol }) => [`"${companyName}" stock`, `"${symbol}" stock`],
  dividend: ({ companyName, symbol }) => [
    `"${companyName}" dividend`,
    `"${symbol}" dividend`,
  ],
  "promoter shareholding": ({ companyName }) => [
    `"${companyName}" promoter shareholding`,
    `"${companyName}" institutional holding`,
  ],
  "shareholder meeting": ({ companyName }) => [
    `"${companyName}" AGM OR EGM OR shareholder meeting`,
  ],
  "investor presentation": ({ companyName }) => [
    `"${companyName}" investor presentation OR concall`,
  ],
  "annual report": ({ companyName }) => [
    `"${companyName}" annual report OR earnings`,
  ],
};

function extractTag(block, tagName) {
  const match = block.match(
    new RegExp(`<${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)</${tagName}>`, "i")
  );
  return match ? cleanDisplayText(match[1].replace(/^<!\[CDATA\[(.*)\]\]>$/s, "$1").trim()) : "";
}

export function parseGoogleNewsRss(xml, category) {
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
      id: slugify(`${category}-${title}-${link}`),
      category,
      source: source || "Google News",
      title,
      url: cleanDisplayText(link),
      publishedAt: pubDate || null,
    });
  }
  return items;
}

async function fetchGoogleNewsQuery(query, category, perQueryLimit) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=en-IN&gl=IN&ceid=IN:en`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "portfolio-intelligence-reporter/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Google News RSS failed for query "${query}" with ${response.status}`);
  }

  const xml = await response.text();
  return parseGoogleNewsRss(xml, category).slice(0, perQueryLimit);
}

export class GoogleNewsRssProvider {
  constructor(config) {
    this.config = config;
  }

  async fetchForHolding(holding) {
    if (!this.config.news?.enabled) {
      return [];
    }

    const categories = this.config.news.queries || [];
    const tasks = [];

    for (const category of categories) {
      const templateBuilder =
        QUERY_TEMPLATES[category] ||
        (() => [`"${holding.companyName}" ${category}`]);
      const queries = templateBuilder(holding).filter(
        (query) => query && !query.includes('"undefined"')
      );
      for (const query of queries) {
        tasks.push(
          fetchGoogleNewsQuery(
            query,
            category,
            this.config.news.perQueryLimit || 4
          ).catch(() => [])
        );
      }
    }

    const nested = await Promise.all(tasks);
    return dedupeBy(nested.flat(), (item) => item.url);
  }
}
