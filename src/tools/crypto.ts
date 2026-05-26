// src/tools/crypto.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tiingoFetch, defaultStartDate, todayDate } from "../services/tiingo.js";
import type { TiingoCryptoPriceData } from "../types.js";

export function registerCryptoTools(server: McpServer): void {

  // ── Crypto price history ─────────────────────────────────────────────────
  server.registerTool(
    "tiingo_crypto_prices",
    {
      title: "Crypto Price History",
      description: `Get OHLCV price history for cryptocurrency pairs from Tiingo.
Args:
  - tickers (string[]): Crypto tickers, e.g. ["btcusd", "ethusd", "solusd"]. Format: {base}{quote} lowercase.
  - startDate (string): Start date YYYY-MM-DD (default: 30 days ago)
  - endDate (string): End date YYYY-MM-DD (default: today)
  - resampleFreq (string): Bar size — "1min" | "5min" | "15min" | "30min" | "1hour" | "4hour" | "1day" (default: "1day")
  - exchanges (string[]): Optional list of exchanges to include, e.g. ["BINANCE", "COINBASE"]
Returns: OHLCV price data per ticker`,
      inputSchema: {
        tickers: z.array(z.string().min(3).max(20)).min(1).max(10).describe("Crypto tickers, e.g. ['btcusd', 'ethusd']"),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date YYYY-MM-DD"),
        resampleFreq: z.enum(["1min", "5min", "15min", "30min", "1hour", "4hour", "1day"]).default("1day").describe("Bar frequency"),
        exchanges: z.array(z.string()).optional().describe("Filter by exchange names")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ tickers, startDate, endDate, resampleFreq, exchanges }: {
      tickers: string[];
      startDate?: string;
      endDate?: string;
      resampleFreq: "1min" | "5min" | "15min" | "30min" | "1hour" | "4hour" | "1day";
      exchanges?: string[];
    }) => {
      const params: Record<string, string> = {
        tickers: tickers.map(t => t.toLowerCase()).join(","),
        startDate: startDate ?? defaultStartDate(30),
        endDate: endDate ?? todayDate(),
        resampleFreq
      };
      if (exchanges?.length) params["exchanges"] = exchanges.join(",");

      const data = await tiingoFetch<TiingoCryptoPriceData[]>("/tiingo/crypto/prices", params);

      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No crypto data found for: ${params["tickers"]}` }] };
      }

      const lines = data.map(item => {
        const pd = item.priceData;
        if (!pd?.length) return `**${item.ticker}**: No price data`;
        const latest = pd[pd.length - 1];
        const first = pd[0];
        const pct = first.close ? (((latest.close - first.close) / first.close) * 100).toFixed(2) : "N/A";
        return `**${item.ticker.toUpperCase()}** (${item.baseCurrency}/${item.quoteCurrency})\n` +
          `Bars: ${pd.length} | Start: $${first.close.toFixed(4)} → Latest: $${latest.close.toFixed(4)} (${pct}%)\n` +
          `Latest [${String(latest.date).slice(0, 19)}]: O:${latest.open.toFixed(4)} H:${latest.high.toFixed(4)} L:${latest.low.toFixed(4)} C:${latest.close.toFixed(4)} Vol:${latest.volume.toLocaleString()}`;
      });

      return {
        content: [{ type: "text" as const, text: lines.join("\n\n") }]
      };
    }
  );

  // ── Crypto real-time top-of-book ─────────────────────────────────────────
  // NOTE v1.1.2: Tiingo has officially deprecated /tiingo/crypto/top. Per their
  // docs they cite unreliable bid/ask construction across 60+ crypto exchanges.
  // The endpoint may return degraded data or stop working entirely. For "last
  // price only" use tiingo_crypto_prices with resampleFreq=1min and read the
  // latest bar.
  server.registerTool(
    "tiingo_crypto_realtime",
    {
      title: "Crypto Real-Time Quote (DEPRECATED)",
      description: `Get real-time top-of-book crypto quotes (latest trade price, bid, ask).

⚠️ DEPRECATED: Tiingo has officially deprecated this endpoint due to unreliable
bid/ask data across crypto exchanges. May return degraded or null data.
For last price only, prefer tiingo_crypto_prices with resampleFreq=1min.

Args:
  - tickers (string[]): Crypto tickers, e.g. ["btcusd", "ethusd"]
Returns: Latest quote data per crypto pair (best effort)`,
      inputSchema: {
        tickers: z.array(z.string().min(3).max(20)).min(1).max(10).describe("Crypto tickers")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ tickers }: { tickers: string[] }) => {
      const params = { tickers: tickers.map(t => t.toLowerCase()).join(",") };
      const data = await tiingoFetch<Array<Record<string, unknown>>>("/tiingo/crypto/top", params);

      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No real-time crypto data for: ${params.tickers} (endpoint deprecated by Tiingo)` }] };
      }

      const lines = data.map(item => {
        const topOfBook = (item["topOfBookData"] as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
        return `**${String(item["ticker"]).toUpperCase()}** | Last: $${Number(topOfBook["lastPrice"]).toFixed(4)} | Bid: ${Number(topOfBook["bidPrice"]).toFixed(4)} x${topOfBook["bidSize"]} Ask: ${Number(topOfBook["askPrice"]).toFixed(4)} x${topOfBook["askSize"]} | Exchange: ${topOfBook["lastExchange"] ?? "—"}`;
      });

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }]
      };
    }
  );
}
