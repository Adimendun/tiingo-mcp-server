// src/tools/screener.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tiingoFetch, defaultStartDate, todayDate } from "../services/tiingo.js";
import type { TiingoIexQuote } from "../types.js";

// Helper: get the latest record by date without assuming sort order.
function latestByDate<T extends Record<string, unknown>>(rows: T[]): T | undefined {
  if (!rows.length) return undefined;
  return [...rows].sort(
    (a, b) => new Date(String(b["date"])).getTime() - new Date(String(a["date"])).getTime()
  )[0];
}

interface ForexBar {
  date: string;
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

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

      // Fetch daily fundamentals per ticker (best effort, 30-day window).
      const fundamentals: Record<string, Record<string, unknown>> = {};
      await Promise.all(upperTickers.map(async (ticker) => {
        try {
          const data = await tiingoFetch<Array<Record<string, unknown>>>(
            `/tiingo/fundamentals/${ticker}/daily`,
            { startDate: defaultStartDate(30), endDate: todayDate() }
          );
          const latest = latestByDate(data);
          if (latest) fundamentals[ticker] = latest;
        } catch {
          // Some tickers may not have fundamentals — silently skip.
        }
      }));

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
  // FIX v1.1.2: forex historical URL needs the ticker IN THE PATH, and the
  // response is a flat array of bars (not wrapped). See forex.ts for context.
  server.registerTool(
    "tiingo_usdmxn",
    {
      title: "USD/MXN Quick Quote",
      description: `Get the current USD/MXN exchange rate and recent history.
Args:
  - days (number): Days of history to show, 1-90 (default: 5)
Returns: Current rate, daily change, and last N days of history`,
      inputSchema: {
        days: z.number().int().min(1).max(90).default(5).describe("Days of history to show (default 5)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ days }: { days: number }) => {
      // Real-time quote
      let realtimeLine = "";
      try {
        const rt = await tiingoFetch<Array<Record<string, unknown>>>("/tiingo/fx/top", { tickers: "usdmxn" });
        if (rt.length) {
          const q = rt[0];
          realtimeLine = `**USD/MXN** | Mid: ${Number(q["midPrice"]).toFixed(4)} | Bid: ${Number(q["bidPrice"]).toFixed(4)} | Ask: ${Number(q["askPrice"]).toFixed(4)} | ${String(q["quoteTimestamp"] ?? "").slice(0, 19)}\n\n`;
        }
      } catch {
        // Fall back to historical only
      }

      // Historical — ticker in path, flat-array response.
      let histLines = "";
      try {
        const bars = await tiingoFetch<ForexBar[]>(
          "/tiingo/fx/usdmxn/prices",
          { startDate: defaultStartDate(days), endDate: todayDate(), resampleFreq: "1day" }
        );

        if (bars.length) {
          histLines = "**Last " + bars.length + " days:**\n" +
            bars.slice(-days).map(b =>
              `${b.date.slice(0, 10)} | O:${b.open.toFixed(4)} H:${b.high.toFixed(4)} L:${b.low.toFixed(4)} C:${b.close.toFixed(4)}`
            ).join("\n");
        }
      } catch (err) {
        histLines = `Historical lookup failed: ${err instanceof Error ? err.message : String(err)}`;
      }

      return { content: [{ type: "text" as const, text: realtimeLine + histLines }] };
    }
  );
}
