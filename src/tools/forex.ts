// src/tools/forex.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tiingoFetch, defaultStartDate, todayDate } from "../services/tiingo.js";
import type { TiingoForexPrice } from "../types.js";

export function registerForexTools(server: McpServer): void {

  // ── Forex price history ──────────────────────────────────────────────────
  server.registerTool(
    "tiingo_forex_prices",
    {
      title: "Forex Price History",
      description: `Get OHLC price history for forex currency pairs from Tiingo.
Args:
  - tickers (string[]): Forex pair tickers, e.g. ["eurusd", "usdjpy", "gbpusd", "usdmxn"]. Format: {base}{quote} lowercase.
  - startDate (string): Start date YYYY-MM-DD (default: 30 days ago)
  - endDate (string): End date YYYY-MM-DD (default: today)
  - resampleFreq (string): Bar size — "1min" | "5min" | "15min" | "30min" | "1hour" | "4hour" | "1day" (default: "1day")
Returns: OHLC price data per forex pair`,
      inputSchema: {
        tickers: z.array(z.string().min(3).max(10)).min(1).max(10).describe("Forex pair tickers, e.g. ['eurusd', 'usdmxn']"),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date YYYY-MM-DD"),
        resampleFreq: z.enum(["1min", "5min", "15min", "30min", "1hour", "4hour", "1day"]).default("1day").describe("Bar frequency")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ tickers, startDate, endDate, resampleFreq }: {
      tickers: string[];
      startDate?: string;
      endDate?: string;
      resampleFreq: "1min" | "5min" | "15min" | "30min" | "1hour" | "4hour" | "1day";
    }) => {
      const params: Record<string, string> = {
        tickers: tickers.map(t => t.toLowerCase()).join(","),
        startDate: startDate ?? defaultStartDate(30),
        endDate: endDate ?? todayDate(),
        resampleFreq
      };

      const data = await tiingoFetch<TiingoForexPrice[]>("/tiingo/fx/prices", params);

      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No forex data found for: ${params["tickers"]}` }] };
      }

      const lines = data.map(item => {
        const pd = item.priceData;
        if (!pd?.length) return `**${item.ticker}**: No price data`;
        const latest = pd[pd.length - 1];
        const first = pd[0];
        const pct = first.close ? (((latest.close - first.close) / first.close) * 100).toFixed(4) : "N/A";
        return `**${item.ticker.toUpperCase()}** (${item.baseCurrency}/${item.quoteCurrency})\n` +
          `Bars: ${pd.length} | Start: ${first.close.toFixed(5)} → Latest: ${latest.close.toFixed(5)} (${pct}%)\n` +
          `Latest [${String(latest.date).slice(0, 10)}]: O:${latest.open.toFixed(5)} H:${latest.high.toFixed(5)} L:${latest.low.toFixed(5)} C:${latest.close.toFixed(5)}`;
      });

      return {
        content: [{ type: "text" as const, text: lines.join("\n\n") }]
      };
    }
  );

  // ── Forex real-time top-of-book ──────────────────────────────────────────
  server.registerTool(
    "tiingo_forex_realtime",
    {
      title: "Forex Real-Time Quote",
      description: `Get real-time forex quotes (latest mid, bid, ask) for currency pairs.
Args:
  - tickers (string[]): Forex pair tickers, e.g. ["eurusd", "usdmxn", "usdjpy"]
Returns: Latest bid/ask/mid per pair`,
      inputSchema: {
        tickers: z.array(z.string().min(3).max(10)).min(1).max(10).describe("Forex pair tickers")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ tickers }: { tickers: string[] }) => {
      const params = { tickers: tickers.map(t => t.toLowerCase()).join(",") };
      const data = await tiingoFetch<Array<Record<string, unknown>>>("/tiingo/fx/top", params);

      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No real-time forex data for: ${params.tickers}` }] };
      }

      const lines = data.map(item =>
        `**${String(item["ticker"]).toUpperCase()}** | Mid: ${Number(item["mid"]).toFixed(5)} | Bid: ${Number(item["bidPrice"]).toFixed(5)} | Ask: ${Number(item["askPrice"]).toFixed(5)} | ${String(item["timestamp"]).slice(0, 19)}`
      );

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }]
      };
    }
  );
}
