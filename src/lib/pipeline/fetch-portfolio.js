import path from "node:path";
import { access } from "node:fs/promises";
import { KiteClient } from "../kite/kite-client.js";
import { applyPortfolioWeights, normalizeHolding } from "../portfolio/normalize.js";
import { ensureDir, isoDateKey, weekKey, writeJson } from "../utils.js";

export function getClosePrice(candle) {
  if (Array.isArray(candle)) {
    return candle[4]; // [timestamp, open, high, low, close, volume, open_interest]
  }
  return candle?.close || candle?.Close || 0;
}

export function calculateSMA(candles, period = 50) {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  const sum = slice.reduce((acc, c) => acc + getClosePrice(c), 0);
  return Number((sum / period).toFixed(2));
}

export function calculateRSI(candles, period = 14) {
  if (candles.length <= period) return null;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const diff = getClosePrice(candles[i]) - getClosePrice(candles[i - 1]);
    if (diff > 0) {
      gains += diff;
    } else {
      losses -= diff;
    }
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  for (let i = period + 1; i < candles.length; i++) {
    const diff = getClosePrice(candles[i]) - getClosePrice(candles[i - 1]);
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

export function calculateVolatility(candles) {
  if (candles.length < 2) return null;
  const returns = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = getClosePrice(candles[i - 1]);
    if (prev > 0) {
      const current = getClosePrice(candles[i]);
      returns.push((current - prev) / prev);
    }
  }
  if (!returns.length) return null;
  const mean = returns.reduce((acc, val) => acc + val, 0) / returns.length;
  const variance = returns.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / returns.length;
  return Number((Math.sqrt(variance) * 100).toFixed(2));
}

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
    const margins = await kite.fetchMargins();
    const orders = await kite.fetchRecentOrders();
    const quoteMap = kite.mapQuoteBySymbol(quotes);

    const today = new Date();
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(today.getDate() - 120); // Get enough trading days for 50 SMA
    const fromDateStr = ninetyDaysAgo.toISOString().slice(0, 10) + " 00:00:00";
    const toDateStr = today.toISOString().slice(0, 10) + " 23:59:59";

    const holdingsWithTrends = [];
    for (const rawHolding of rawHoldings) {
      const holding = normalizeHolding(rawHolding, quoteMap);
      const token = rawHolding.instrument_token || holding.quote?.instrument_token || holding.quote?.instrumentToken;
      
      let trendData = {
        sma50: null,
        rsi14: null,
        volatility: null,
        status: "no_token",
      };

      if (token) {
        const candles = await kite.fetchHistoricalData(token, "day", fromDateStr, toDateStr);
        if (candles && candles.length) {
          trendData = {
            sma50: calculateSMA(candles, 50),
            rsi14: calculateRSI(candles, 14),
            volatility: calculateVolatility(candles),
            status: "success",
          };
        } else {
          trendData.status = "no_candles";
        }
      }

      holdingsWithTrends.push({
        ...holding,
        trends: trendData,
      });
    }

    const holdings = applyPortfolioWeights(holdingsWithTrends);

    const snapshot = {
      generatedAt: new Date().toISOString(),
      holdings,
      positions,
      trades,
      margins,
      orders,
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

