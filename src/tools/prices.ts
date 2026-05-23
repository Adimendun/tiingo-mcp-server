// src/tools/prices.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tiingoFetch, defaultStartDate, todayDate } from "../services/tiingo.js";
import type { TiingoDailyPrice, TiingoTickerMeta, TiingoIexQuote } from "../types.js";

export function registerPriceTools(server: McpServer): void {

  server.registerTool(
    "tiingo_ticker_meta",
    {
      title: "Ticker Metadata",
      description: `Get metadata for a stock ticker: full company name, exchange, and date range of available data.
Args:
  - ticker (string): Stock ticker symbol, e.g. "AAPL", "MSFT"
Returns: name, description, exchange, startDate, endDate`,
      inputSchema: {
        ticker: z.string().min(1).max(10).describe("Stock ticker symbol, e.g. AAPL")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ ticker }: { ticker: string }) => {
      const data = await tiingoFetch<TiingoTickerMeta>(`/tiingo/daily/${ticker.toUpperCase()}`);
      const text = `**${data.name}** (${data.ticker}) — ${data.exchangeCode}\nData available: ${data.startDate} to ${data.endDate}\n\n${data.description?.slice(0, 500) ?? ""}`;
      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.registerTool(
    "tiingo_prices_eod",
    {
      title: "End-of-Day Historical Prices",
      description: `Get adjusted EOD OHLCV prices for a stock. Returns open, high, low, close, volume, and adjusted equivalents.
Args:
  - ticker (string): Stock ticker, e.g. "AAPL"
  - startDate (string): Start date YYYY-MM-DD (default: 1 year ago)
  - endDate (string): End date YYYY-MM-DD (default: today)
  - resampleFreq (string): "daily" | "weekly" | "monthly" (default: "daily")
Returns: Array of OHLCV bars with adjusted prices`,
      inputSchema: {
        ticker: z.string().min(1).max(10).describe("Stock ticker symbol"),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date YYYY-MM-DD"),
        resampleFreq: z.enum(["daily", "weekly", "monthly"]).default("daily").describe("Bar frequency")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ ticker, startDate, endDate, resampleFreq }: {
      ticker: string;
      startDate?: string;
      endDate?: string;
      resampleFreq: "daily" | "weekly" | "monthly";
    }) => {
      const params: Record<string, string> = {
        startDate: startDate ?? defaultStartDate(365),
        endDate: endDate ?? todayDate(),
        resampleFreq
      };
      const data = await tiingoFetch<TiingoDailyPrice[]>(`/tiingo/daily/${ticker.toUpperCase()}/prices`, params);
      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No price data found for ${ticker} in the given range.` }] };
      }
      const latest = data[data.length - 1];
      const first = data[0];
      const pctChange = (((latest.adjClose - first.adjClose) / first.adjClose) * 100).toFixed(2);
      const summary =
        `**${ticker.toUpperCase()}** — ${params["startDate"]} to ${params["endDate"]} (${resampleFreq})\n` +
        `Bars: ${data.length} | Start: $${first.adjClose.toFixed(2)} to End: $${latest.adjClose.toFixed(2)} (${pctChange}%)\n` +
        `Latest: O ${latest.adjOpen.toFixed(2)} H ${latest.adjHigh.toFixed(2)} L ${latest.adjLow.toFixed(2)} C ${latest.adjClose.toFixed(2)} Vol ${latest.adjVolume?.toLocaleString()}\n\nLast 5 bars:\n` +
        data.slice(-5).map(b =>
          `${b.date.slice(0, 10)} | O:${b.adjOpen.toFixed(2)} H:${b.adjHigh.toFixed(2)} L:${b.adjLow.toFixed(2)} C:${b.adjClose.toFixed(2)} V:${b.adjVolume?.toLocaleString()}`
        ).join("\n");
      return { content: [{ type: "text" as const, text: summary }] };
    }
  );

  server.registerTool(
    "tiingo_quote_realtime",
    {
      title: "Real-Time Quote",
      description: `Get the latest real-time quote for one or more stock tickers via Tiingo IEX feed. Includes bid/ask, last price, volume, and previous close.
Args:
  - tickers (string[]): Array of ticker symbols, e.g. ["AAPL", "MSFT", "NVDA"]
Returns: Latest quote data per ticker`,
      inputSchema: {
        tickers: z.array(z.string().min(1).max(10)).min(1).max(20).describe("Array of ticker symbols")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ tickers }: { tickers: string[] }) => {
      const tickerStr = tickers.map(t => t.toUpperCase()).join(",");
      const data = await tiingoFetch<TiingoIexQuote[]>(`/iex`, { tickers: tickerStr });
      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No real-time data available for: ${tickerStr}` }] };
      }
      const lines = data.map(q => {
        const chg = q.prevClose ? (((q.tngoLast - q.prevClose) / q.prevClose) * 100).toFixed(2) : "N/A";
        return `**${q.ticker}** $${q.tngoLast?.toFixed(2)} (${chg}%) | Bid: ${q.bidPrice?.toFixed(2)} x${q.bidSize} Ask: ${q.askPrice?.toFixed(2)} x${q.askSize} | Vol: ${q.volume?.toLocaleString()} | ${q.timestamp?.slice(0, 19)}`;
      });
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "tiingo_prices_intraday",
    {
      title: "Intraday Price Data",
      description: `Get intraday OHLCV data for a stock ticker. Useful for same-day or recent session analysis.
Args:
  - ticker (string): Stock ticker symbol
  - startDate (string): Start date YYYY-MM-DD (default: today)
  - endDate (string): End date YYYY-MM-DD (default: today)
  - resampleFreq (string): "1min" | "5min" | "15min" | "30min" | "1hour" (default: "5min")
Returns: Intraday OHLCV bars`,
      inputSchema: {
        ticker: z.string().min(1).max(10).describe("Stock ticker symbol"),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date YYYY-MM-DD"),
        resampleFreq: z.enum(["1min", "5min", "15min", "30min", "1hour"]).default("5min").describe("Bar size")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ ticker, startDate, endDate, resampleFreq }: {
      ticker: string;
      startDate?: string;
      endDate?: string;
      resampleFreq: "1min" | "5min" | "15min" | "30min" | "1hour";
    }) => {
      const params: Record<string, string> = {
        startDate: startDate ?? todayDate(),
        endDate: endDate ?? todayDate(),
        resampleFreq
      };
      const data = await tiingoFetch<Array<Record<string, unknown>>>(`/iex/${ticker.toUpperCase()}`, params);
      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No intraday data for ${ticker} on the given date(s).` }] };
      }
      const lines = data.slice(-20).map(b =>
        `${String(b["date"]).slice(0, 19)} | O:${Number(b["open"]).toFixed(2)} H:${Number(b["high"]).toFixed(2)} L:${Number(b["low"]).toFixed(2)} C:${Number(b["close"]).toFixed(2)} V:${Number(b["volume"]).toLocaleString()}`
      );
      const text = `**${ticker.toUpperCase()}** intraday (${resampleFreq}) — ${params["startDate"]} to ${params["endDate"]}\nBars returned: ${data.length} (showing last 20)\n\n${lines.join("\n")}`;
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
