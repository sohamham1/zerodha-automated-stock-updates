import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { isoDateKey, parseKiteDate, safeNumber, weekKey, writeJson } from "../utils.js";

function equityTradeFilter(trade) {
  const exchange = String(trade.exchange || "").toUpperCase();
  const product = String(trade.product || "").toUpperCase();
  return (exchange === "NSE" || exchange === "BSE") && product === "CNC";
}

function tradeDate(trade) {
  return parseKiteDate(trade.fill_timestamp || trade.exchange_timestamp || trade.order_timestamp);
}

function normalizeTrade(trade) {
  return {
    symbol: trade.tradingsymbol,
    exchange: trade.exchange,
    transactionType: String(trade.transaction_type || "").toUpperCase(),
    quantity: safeNumber(trade.quantity),
    averagePrice: safeNumber(trade.average_price),
    value:
      safeNumber(trade.quantity) * safeNumber(trade.average_price),
    timestamp: trade.fill_timestamp || trade.exchange_timestamp || trade.order_timestamp || null,
    orderId: trade.order_id || null,
    tradeId: trade.trade_id || null,
    raw: trade,
  };
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function listTradeFiles(cacheDir) {
  const tradesDir = path.join(cacheDir, "trades");
  try {
    const entries = await readdir(tradesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(tradesDir, entry.name));
  } catch {
    return [];
  }
}

function withinWeek(date, weekStart) {
  return Boolean(date) && date.toISOString().slice(0, 10) >= weekStart;
}

export async function cacheTodayTrades(config, trades, today = new Date()) {
  const filePath = path.join(config.paths.cacheDir, "trades", `${isoDateKey(today)}.json`);
  await writeJson(filePath, {
    generatedAt: new Date().toISOString(),
    trades,
  });
  return filePath;
}

function summarizeTradesForHolding(holding, trades, baselineHolding) {
  const relevant = trades.filter(
    (trade) => trade.symbol === holding.symbol && trade.exchange === holding.exchange
  );
  const buyQty = relevant
    .filter((trade) => trade.transactionType === "BUY")
    .reduce((sum, trade) => sum + trade.quantity, 0);
  const sellQty = relevant
    .filter((trade) => trade.transactionType === "SELL")
    .reduce((sum, trade) => sum + trade.quantity, 0);
  const buyValue = relevant
    .filter((trade) => trade.transactionType === "BUY")
    .reduce((sum, trade) => sum + trade.value, 0);
  const sellValue = relevant
    .filter((trade) => trade.transactionType === "SELL")
    .reduce((sum, trade) => sum + trade.value, 0);

  let exactWeeklyPnl = null;
  let weeklyPnlMethod = "limited";
  if (baselineHolding) {
    let runningQty = safeNumber(baselineHolding.quantity);
    let runningCost = safeNumber(baselineHolding.averagePrice);
    let realised = 0;

    for (const trade of relevant
      .slice()
      .sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""))) {
      if (trade.transactionType === "BUY") {
        const totalCost = runningQty * runningCost + trade.quantity * trade.averagePrice;
        runningQty += trade.quantity;
        runningCost = runningQty ? totalCost / runningQty : 0;
      } else if (trade.transactionType === "SELL") {
        realised += (trade.averagePrice - runningCost) * trade.quantity;
        runningQty -= trade.quantity;
      }
    }

    exactWeeklyPnl = realised;
    weeklyPnlMethod = "exact_from_first_cached_week_snapshot";
  }

  return {
    tradesCount: relevant.length,
    buyQty,
    sellQty,
    netQty: buyQty - sellQty,
    buyValue,
    sellValue,
    exactWeeklyPnl,
    weeklyPnlMethod,
    transactions: relevant,
  };
}

export async function buildWeeklyActivitySummary(config, holdings, todayTrades) {
  const currentWeek = weekKey();
  await cacheTodayTrades(config, todayTrades);
  const files = await listTradeFiles(config.paths.cacheDir);
  const weeklyTrades = [];

  for (const file of files) {
    const payload = await readJsonIfExists(file);
    for (const trade of payload?.trades || []) {
      const parsedDate = tradeDate(trade);
      if (!equityTradeFilter(trade) || !withinWeek(parsedDate, currentWeek)) {
        continue;
      }
      weeklyTrades.push(normalizeTrade(trade));
    }
  }

  const baselineSnapshotPath = path.join(
    config.paths.cacheDir,
    "holdings",
    `${currentWeek}.json`
  );
  const baselineSnapshot = await readJsonIfExists(baselineSnapshotPath);
  const baselineMap = new Map(
    (baselineSnapshot?.holdings || []).map((item) => [
      `${item.exchange}:${item.symbol}`,
      item,
    ])
  );

  return new Map(
    holdings.map((holding) => [
      `${holding.exchange}:${holding.symbol}`,
      summarizeTradesForHolding(
        holding,
        weeklyTrades,
        baselineMap.get(`${holding.exchange}:${holding.symbol}`) || null
      ),
    ])
  );
}
