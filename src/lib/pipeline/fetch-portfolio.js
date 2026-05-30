import path from "node:path";
import { access } from "node:fs/promises";
import { KiteClient } from "../kite/kite-client.js";
import { applyPortfolioWeights, normalizeHolding } from "../portfolio/normalize.js";
import { ensureDir, isoDateKey, weekKey, writeJson } from "../utils.js";

export async function fetchPortfolioSnapshot({ config }) {
  const kite = new KiteClient(config);
  await kite.connect();
  await kite.ensureLogin();

  try {
    const rawHoldings = await kite.fetchHoldings();
    const instrumentKeys = rawHoldings.map((item) => {
      const exchange = item.exchange || "NSE";
      const symbol = item.tradingsymbol || item.symbol;
      return exchange && symbol ? `${exchange}:${symbol}` : null;
    });

    const quotes = await kite.fetchQuotes(instrumentKeys.filter(Boolean));
    const positions = await kite.fetchPositions();
    const trades = await kite.fetchTrades();
    const quoteMap = kite.mapQuoteBySymbol(quotes);
    const holdings = applyPortfolioWeights(
      rawHoldings.map((item) => normalizeHolding(item, quoteMap))
    );

    const snapshot = {
      generatedAt: new Date().toISOString(),
      holdings,
      positions,
      trades,
    };

    const holdingsDir = await ensureDir(path.join(config.paths.cacheDir, "holdings"));
    const snapshotPath = path.join(holdingsDir, `${weekKey()}.json`);
    try {
      await access(snapshotPath);
    } catch {
      await writeJson(snapshotPath, snapshot);
    }
    const dailySnapshotPath = path.join(
      holdingsDir,
      `${isoDateKey()}.daily.json`
    );
    await writeJson(dailySnapshotPath, snapshot);
    return {
      ...snapshot,
      snapshotPath,
    };
  } finally {
    kite.close();
  }
}
