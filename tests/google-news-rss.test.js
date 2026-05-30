import test from "node:test";
import assert from "node:assert/strict";
import { parseGoogleNewsRss } from "../src/lib/providers/google-news-rss.js";

test("parseGoogleNewsRss extracts item fields", () => {
  const xml = `
  <rss>
    <channel>
      <item>
        <title><![CDATA[Infosys dividend announced]]></title>
        <link>https://example.com/news-1</link>
        <pubDate>Fri, 30 May 2026 10:00:00 GMT</pubDate>
        <source url="https://example.com">Example News</source>
      </item>
    </channel>
  </rss>`;

  const items = parseGoogleNewsRss(xml, "dividend");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Infosys dividend announced");
  assert.equal(items[0].category, "dividend");
});
