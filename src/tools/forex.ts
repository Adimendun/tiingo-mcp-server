// src/tools/forex.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tiingoFetch, defaultStartDate, todayDate } from "../services/tiingo.js";

// ─────────────────────────────────────────────────────────────────────────────
// Forex API notes (per Tiingo docs, confirmed via live testing v1.1.2):
//
// 1) Tiingo Forex is currently in BETA per their docs. Behavior may change.
//
// 2) The historical prices endpoint requires the ticker IN THE PATH:
//      /tiingo/fx/<ticker>/prices?startDate=...&resampleFreq=...
//    There is no documented multi-ticker query variant. The previous code
//    tried `/tiingo/fx/prices?tickers=...` — Tiingo returns SOMETHING but with
//    a flat-array shape that didn't match the wrapped `{ticker, priceData}`
//    structure assumed by the code, so every bar became "No price data".
//
// 3) The response is a FLAT array of bars: `[{date, ticker, open, high, low,
//    close}, ...]`. Unlike crypto (`{ticker, baseCurrency, priceData: [...]}`),
//    forex does not wrap.
//
// 4) For multi-ticker support, loop with Promise.all over single-ticker calls.
// ─────────────────────────────────────────────────────────────────────────────

interface ForexBar {
  date: string;
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function registerForexTools(server: McpServer): void {

  // ── Forex price history ──────────────────────────────────────────────────
  server.registerTool(
    "tiingo_forex_prices",
    {
      title: "Forex Price History",
      description: `Get OHLC price history for forex currency pairs from Tiingo. Forex API is in beta.
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
      const sd = startDate ?? defaultStartDate(30);
      const ed = endDate ?? todayDate();
      const params = { startDate: sd, endDate: ed, resampleFreq };

      // Hit one URL per ticker (Tiingo Forex API has no documented multi-ticker variant)
      const results = await Promise.all(
        tickers.map(async (t) => {
          const lower = t.toLowerCase();
          try {
            const bars = await tiingoFetch<ForexBar[]>(`/tiingo/fx/${lower}/prices`, params);
            return { ticker: lower, bars, error: null as string | null };
          } catch (err) {
            return { ticker: lower, bars: [] as ForexBar[], error: err instanceof Error ? err.message : String(err) };
          }
        })
      );

      const lines = results.map(({ ticker, bars, error }) => {
        if (error) return `**${ticker.toUpperCase()}**: error — ${error}`;
        if (!bars.length) return `**${ticker.toUpperCase()}**: No price data`;
        const latest = bars[bars.length - 1];
        const first = bars[0];
        const pct = first.close ? (((latest.close - first.close) / first.close) * 100).toFixed(4) : "N/A";
        return `**${ticker.toUpperCase()}**\n` +
          `Bars: ${bars.length} | Start: ${first.close.toFixed(5)} → Latest: ${latest.close.toFixed(5)} (${pct}%)\n` +
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
      description: `Get real-time forex quotes (latest mid, bid, ask) for currency pairs. Forex API is in beta.
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

      // Per Tiingo doc: fields are midPrice, bidPrice, askPrice, bidSize, askSize, quoteTimestamp
      const lines = data.map(item =>
        `**${String(item["ticker"]).toUpperCase()}** | Mid: ${Number(item["midPrice"]).toFixed(5)} | Bid: ${Number(item["bidPrice"]).toFixed(5)} | Ask: ${Number(item["askPrice"]).toFixed(5)} | ${String(item["quoteTimestamp"] ?? "").slice(0, 19)}`
      );

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }]
      };
    }
  );
}
