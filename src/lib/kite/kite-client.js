import { McpStdioClient } from "../mcp/stdio-client.js";
import { dedupeBy, pickFirst } from "../utils.js";

function maybeJsonParse(value) {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractToolPayload(result) {
  if (result?.structuredContent) {
    return result.structuredContent;
  }

  if (Array.isArray(result?.content)) {
    for (const item of result.content) {
      if (item?.type === "text" && item.text) {
        const parsed = maybeJsonParse(item.text);
        if (parsed !== item.text) {
          return parsed;
        }
      }
    }
  }

  return result;
}

function normalizeQuotePayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload?.data && Array.isArray(payload.data)) {
    return payload.data;
  }

  if (payload?.data && typeof payload.data === "object") {
    return Object.entries(payload.data).map(([instrument, quote]) => ({
      instrument,
      ...quote,
    }));
  }

  return [];
}

export class KiteClient {
  constructor(config) {
    this.config = config;
    this.mcp = new McpStdioClient({
      command: config.kite.command,
      args: config.kite.args,
      cwd: config.cwd,
      onLog: (text) => {
        const cleaned = String(text).trim();
        if (cleaned) {
          console.error(`[kite-mcp] ${cleaned}`);
        }
      },
    });
    this.toolMap = new Map();
  }

  async connect() {
    await this.mcp.start();
    const tools = await this.mcp.listTools();
    this.toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  }

  async ensureLogin() {
    if (!this.toolMap.has("login")) {
      return;
    }

    try {
      await this.mcp.callTool("profile", {});
      return;
    } catch {
      const result = extractToolPayload(await this.mcp.callTool("login", {}));
      const message = JSON.stringify(result, null, 2);
      console.log("Kite login may be required. Follow the MCP instructions below:");
      console.log(message);
      console.log("Press Enter after you finish the Zerodha auth flow.");
      await new Promise((resolve) => process.stdin.once("data", () => resolve()));
    }
  }

  async fetchHoldings() {
    const toolName = this.toolMap.has("get_holdings")
      ? "get_holdings"
      : this.toolMap.has("holdings")
        ? "holdings"
        : null;

    if (!toolName) {
      throw new Error("Kite MCP does not expose a holdings tool.");
    }

    const payload = extractToolPayload(await this.mcp.callTool(toolName, {}));
    const holdings = payload?.holdings || payload?.data || payload || [];
    return Array.isArray(holdings) ? holdings : [];
  }

  async fetchQuotes(instruments) {
    const toolName = this.toolMap.has("get_quotes")
      ? "get_quotes"
      : this.toolMap.has("quote")
        ? "quote"
        : null;

    if (!toolName || !instruments.length) {
      return [];
    }

    const unique = dedupeBy(instruments, (item) => item).filter(Boolean);
    const argumentCandidates = [
      { instruments: unique },
      { instrument_tokens: unique },
      { symbols: unique },
      { tradingsymbols: unique },
    ];

    for (const args of argumentCandidates) {
      try {
        const payload = extractToolPayload(await this.mcp.callTool(toolName, args));
        return normalizeQuotePayload(payload);
      } catch {
        continue;
      }
    }

    return [];
  }

  async fetchPositions() {
    const toolName = this.toolMap.has("get_positions")
      ? "get_positions"
      : this.toolMap.has("positions")
        ? "positions"
        : null;

    if (!toolName) {
      return { net: [], day: [] };
    }

    const payload = extractToolPayload(await this.mcp.callTool(toolName, {}));
    const data = payload?.data || payload || {};
    return {
      net: Array.isArray(data.net) ? data.net : [],
      day: Array.isArray(data.day) ? data.day : [],
    };
  }

  async fetchTrades() {
    const toolName = this.toolMap.has("get_trades")
      ? "get_trades"
      : this.toolMap.has("trades")
        ? "trades"
        : null;

    if (!toolName) {
      return [];
    }

    const payload = extractToolPayload(await this.mcp.callTool(toolName, {}));
    const trades = payload?.data || payload || [];
    return Array.isArray(trades) ? trades : [];
  }

  async fetchMargins() {
    const toolName = this.toolMap.has("get_margins")
      ? "get_margins"
      : this.toolMap.has("margins")
        ? "margins"
        : null;

    if (!toolName) {
      return {};
    }

    try {
      const payload = extractToolPayload(await this.mcp.callTool(toolName, {}));
      return payload?.data || payload || {};
    } catch {
      return {};
    }
  }

  async fetchRecentOrders() {
    const toolName = this.toolMap.has("get_orders")
      ? "get_orders"
      : this.toolMap.has("orders")
        ? "orders"
        : null;

    if (!toolName) {
      return [];
    }

    try {
      const payload = extractToolPayload(await this.mcp.callTool(toolName, {}));
      const orders = payload?.data || payload || [];
      return Array.isArray(orders) ? orders : [];
    } catch {
      return [];
    }
  }

  async fetchHistoricalData(instrumentToken, interval, fromDate, toDate) {
    const toolName = this.toolMap.has("get_historical_data")
      ? "get_historical_data"
      : this.toolMap.has("historical_data")
        ? "historical_data"
        : null;

    if (!toolName) {
      return [];
    }

    try {
      const payload = extractToolPayload(
        await this.mcp.callTool(toolName, {
          instrument_token: Number(instrumentToken),
          interval,
          from_date: fromDate,
          to_date: toDate,
        })
      );
      const list = payload?.data?.candles || payload?.candles || payload || [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      console.error(`[kite-mcp] Error fetching historical data for token ${instrumentToken}:`, e.message);
      return [];
    }
  }


  mapQuoteBySymbol(quotes) {
    const map = new Map();
    for (const quote of quotes) {
      const key = pickFirst(
        quote.instrument,
        quote.tradingsymbol,
        quote.symbol,
        quote.instrument_token
      );
      if (key) {
        map.set(String(key), quote);
      }
    }
    return map;
  }

  close() {
    this.mcp.close();
  }
}
