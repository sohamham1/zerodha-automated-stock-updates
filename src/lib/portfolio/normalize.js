import { pickFirst, safeNumber } from "../utils.js";

export function normalizeHolding(raw, quoteMap = new Map()) {
  const symbol = pickFirst(raw.tradingsymbol, raw.symbol, raw.ticker);
  const exchange = pickFirst(raw.exchange, raw.segment, "NSE");
  const companyName = pickFirst(raw.company_name, raw.name, symbol);
  const instrumentKey = `${exchange}:${symbol}`;
  const quote =
    quoteMap.get(instrumentKey) ||
    quoteMap.get(symbol) ||
    quoteMap.get(String(raw.instrument_token)) ||
    {};

  const quantity = safeNumber(pickFirst(raw.quantity, raw.net_quantity));
  const averagePrice = safeNumber(
    pickFirst(raw.average_price, raw.avg_price, raw.cost_price)
  );
  const lastPrice = safeNumber(
    pickFirst(raw.last_price, quote.last_price, quote.lastPrice)
  );
  const closePrice = safeNumber(
    pickFirst(raw.close_price, quote.close, quote.ohlc?.close)
  );
  const investedValue = quantity * averagePrice;
  const currentValue = quantity * lastPrice;
  const pnl = safeNumber(raw.pnl, currentValue - investedValue);
  const returnPct = investedValue ? (pnl / investedValue) * 100 : 0;
  const weeklyChangePct = safeNumber(
    pickFirst(raw.weekly_change_pct, quote.weekly_change_pct),
    closePrice ? ((lastPrice - closePrice) / closePrice) * 100 : 0
  );

  return {
    symbol,
    exchange,
    instrumentKey,
    isin: pickFirst(raw.isin, raw.ISIN),
    companyName,
    quantity,
    averagePrice,
    lastPrice,
    closePrice,
    investedValue,
    currentValue,
    pnl,
    returnPct,
    weeklyChangePct,
    portfolioWeight: 0,
    openingQuantity: safeNumber(raw.opening_quantity),
    usedQuantity: safeNumber(raw.used_quantity),
    realisedQuantity: safeNumber(raw.realised_quantity),
    t1Quantity: safeNumber(raw.t1_quantity),
    raw,
    quote,
  };
}

export function applyPortfolioWeights(holdings) {
  const totalValue = holdings.reduce((sum, item) => sum + item.currentValue, 0);
  return holdings.map((item) => ({
    ...item,
    portfolioWeight: totalValue ? (item.currentValue / totalValue) * 100 : 0,
  }));
}
