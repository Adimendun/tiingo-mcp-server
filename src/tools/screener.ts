// src/tools/screener.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tiingoFetch, defaultStartDate, todayDate } from "../services/tiingo.js";
import type { TiingoIexQuote } from "../types.js";

export function registerScreenerTools(server: McpServer): void {

  // ── Compare multiple tickers ─────────────────────────────────────────────
  server.registerTool(
    "tiingo_compare_tickers",
    {
      title: "Compare Tickers",
      description: `Compare multiple stocks side by side with real-time quotes and daily fundamental metrics (P/E, market cap, EV/EBITDA). Great for sector comparisons.
Args:
  - tickers (string[]): 2-15 ticker symbols, e.g. ["GEV", "CEG", "VST", "NRG", "TLN"]
Returns: Comparison table with price, change%, volume, and available valuation metrics`,
      inputSchema: {
        tickers: z.array(z.string().min(1).max(10)).min(2).max(15).describe("Ticker symbols to compare")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ tickers }: { tickers: string[] }) => {
      const upperTickers = tickers.map(t => t.toUpperCase());

      // Fetch real-time quotes
      const quotes = await tiingoFetch<TiingoIexQuote[]>(`/iex`, { tickers: upperTickers.join(",") });

      // Fetch daily fundamentals for each ticker (best effort)
      const fundamentals: Record<string, Record<string, unknown>> = {};
      await Promise.all(upperTickers.map(async (ticker) => {
        try {
          const data = await tiingoFetch<Array<Record<string, unknown>>>(`/fundamentals/${ticker}/daily`, {
            startDate: defaultStartDate(7),
            endDate: todayDate()
          });
          if (data.length) fundamentals[ticker] = data[data.length - 1];
        } catch {
          // Some tickers may not have fundamentals
        }
      }));

      // Build comparison
      const lines = upperTickers.map(ticker => {
        const q = quotes.find(q => q.ticker === ticker);
        const f = fundamentals[ticker];

        const price = q ? `$${q.tngoLast?.toFixed(2)}` : "—";
        const chg = q?.prevClose ? `${(((q.tngoLast - q.prevClose) / q.prevClose) * 100).toFixed(2)}%` : "—";
        const vol = q?.volume ? q.volume.toLocaleString() : "—";

        const marketCap = f?.["marketCap"] ? `$${(Number(f["marketCap"]) / 1e9).toFixed(1)}B` : "—";
        const pe = f?.["peRatio"] != null ? Number(f["peRatio"]).toFixed(1) : "—";
        const ev = f?.["enterpriseVal"] ? `$${(Number(f["enterpriseVal"]) / 1e9).toFixed(1)}B` : "—";

        return `**${ticker}** | ${price} (${chg}) | Vol: ${vol} | MCap: ${marketCap} | P/E: ${pe} | EV: ${ev}`;
      });

      const header = `**Comparativo** — ${upperTickers.length} tickers | ${todayDate()}\n\n`;
      return { content: [{ type: "text" as const, text: header + lines.join("\n") }] };
    }
  );

  // ── Watchlist movers ─────────────────────────────────────────────────────
  server.registerTool(
    "tiingo_watchlist_movers",
    {
      title: "Watchlist Movers",
      description: `Check a watchlist of tickers and highlight significant movers. Shows all tickers sorted by absolute % change, flagging any that moved more than the threshold.
Args:
  - tickers (string[]): Watchlist ticker symbols, e.g. ["AAPL", "NVDA", "GEV", "CEG", "VST"]
  - threshold (number): Minimum absolute % change to flag as significant (default: 2.0)
Returns: All tickers with prices sorted by movement, significant movers highlighted`,
      inputSchema: {
        tickers: z.array(z.string().min(1).max(10)).min(1).max(30).describe("Watchlist tickers"),
        threshold: z.number().min(0.1).max(50).default(2.0).describe("% threshold to flag movers (default 2%)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ tickers, threshold }: { tickers: string[]; threshold: number }) => {
      const upperTickers = tickers.map(t => t.toUpperCase());
      const quotes = await tiingoFetch<TiingoIexQuote[]>(`/iex`, { tickers: upperTickers.join(",") });

      if (!quotes.length) {
        return { content: [{ type: "text" as const, text: `No data available for: ${upperTickers.join(", ")}` }] };
      }

      const rows = quotes.map(q => {
        const pctChg = q.prevClose ? ((q.tngoLast - q.prevClose) / q.prevClose) * 100 : 0;
        return { ticker: q.ticker, price: q.tngoLast, pctChg, volume: q.volume, isSignificant: Math.abs(pctChg) >= threshold };
      }).sort((a, b) => Math.abs(b.pctChg) - Math.abs(a.pctChg));

      const significant = rows.filter(r => r.isSignificant);
      const alertHeader = significant.length > 0
        ? `🚨 **${significant.length} mover(s) above ${threshold}% threshold:**\n` +
          significant.map(r => `  **${r.ticker}** ${r.pctChg >= 0 ? "+" : ""}${r.pctChg.toFixed(2)}% → $${r.price?.toFixed(2)}`).join("\n") +
          "\n\n"
        : `No movers above ${threshold}% threshold today.\n\n`;

      const fullList = rows.map(r => {
        const flag = r.isSignificant ? " ⚡" : "";
        return `${r.ticker}${flag} | $${r.price?.toFixed(2)} (${r.pctChg >= 0 ? "+" : ""}${r.pctChg.toFixed(2)}%) | Vol: ${r.volume?.toLocaleString()}`;
      }).join("\n");

      return { content: [{ type: "text" as const, text: alertHeader + "**Full watchlist (sorted by |change|):**\n" + fullList }] };
    }
  );

  // ── Quick USDMXN ─────────────────────────────────────────────────────────
  server.registerTool(
    "tiingo_usdmxn",
    {
      title: "USD/MXN Quick Quote",
      description: `Get the current USD/MXN exchange rate and recent history. No parameters needed — just call it.
Returns: Current rate, daily change, and last 5 days of history`,
      inputSchema: {
        days: z.number().int().min(1).max(90).default(5).describe("Days of history to show (default 5)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ days }: { days: number }) => {
      // Real-time quote
      let realtimeLine = "";
      try {
        const rt = await tiingoFetch<Array<Record<string, unknown>>>("/fx", { tickers: "usdmxn" });
        if (rt.length) {
          const q = rt[0];
          realtimeLine = `**USD/MXN** | Mid: ${Number(q["midPrice"]).toFixed(4)} | Bid: ${Number(q["bidPrice"]).toFixed(4)} | Ask: ${Number(q["askPrice"]).toFixed(4)} | ${String(q["timestamp"]).slice(0, 19)}\n\n`;
        }
      } catch {
        // Fall back to historical only
      }

      // Historical
      const hist = await tiingoFetch<Array<{ priceData: Array<{ date: string; open: number; high: number; low: number; close: number }> }>>("/fx/prices", {
        tickers: "usdmxn",
        startDate: defaultStartDate(days),
        endDate: todayDate(),
        resampleFreq: "1day"
      });

      let histLines = "";
      if (hist.length && hist[0].priceData?.length) {
        const pd = hist[0].priceData;
        histLines = "**Last " + pd.length + " days:**\n" +
          pd.slice(-days).map(b =>
            `${b.date.slice(0, 10)} | O:${b.open.toFixed(4)} H:${b.high.toFixed(4)} L:${b.low.toFixed(4)} C:${b.close.toFixed(4)}`
          ).join("\n");
      }

      return { content: [{ type: "text" as const, text: realtimeLine + histLines }] };
    }
  );
}
