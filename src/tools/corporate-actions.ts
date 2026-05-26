// src/tools/corporate-actions.ts
//
// Corporate action endpoints — dividends, distribution yield, splits.
//
// PER TIINGO DOCS: "The new Corporate Action endpoints ... are currently
// available to Beta-enabled customers and enterprise customers as an early
// release product. If you would like access, please E-mail support@tiingo.com"
//
// Translation: if your token doesn't have beta entitlement, every call here
// will return an auth error. The error message from Tiingo will explain.
//
// Quirk worth noting: Tiingo's distributions response has a typo — the JSON
// field is literally "distributionFreqency" (missing an N). The TiingoDistribution
// type and the code below preserve that exact spelling on purpose.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tiingoFetch } from "../services/tiingo.js";
import type {
  TiingoDistribution,
  TiingoDistributionYield,
  TiingoSplit
} from "../types.js";
import { DISTRIBUTION_FREQUENCY } from "../types.js";

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return String(s).slice(0, 10);
}

function fmtNum(n: number | null | undefined, decimals = 4): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(decimals);
}

function freqLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return DISTRIBUTION_FREQUENCY[code] ?? code;
}

export function registerCorporateActionsTools(server: McpServer): void {

  // ── Distributions (dividends) ────────────────────────────────────────────
  server.registerTool(
    "tiingo_distributions",
    {
      title: "Distributions (Dividends)",
      description: `Get distribution (dividend) history for a stock, ETF, or mutual fund. Returns ex-date, payment date, record date, declaration date, distribution amount, and declared frequency.
Requires Tiingo beta or enterprise entitlement on your token.
Args:
  - ticker (string): Stock/ETF/MF ticker symbol, e.g. "KO", "JEPI", "VYM"
  - startExDate (string): Start ex-date YYYY-MM-DD (optional; default returns full history)
  - endExDate (string): End ex-date YYYY-MM-DD (optional)
Returns: Up to 20 most recent distributions, with totals and average over the window.`,
      inputSchema: {
        ticker: z.string().min(1).max(10).describe("Stock/ETF/MF ticker symbol"),
        startExDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start ex-date YYYY-MM-DD"),
        endExDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End ex-date YYYY-MM-DD")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ ticker, startExDate, endExDate }: { ticker: string; startExDate?: string; endExDate?: string }) => {
      const params: Record<string, string> = {};
      if (startExDate) params["startExDate"] = startExDate;
      if (endExDate) params["endExDate"] = endExDate;

      const data = await tiingoFetch<TiingoDistribution[]>(
        `/tiingo/corporate-actions/${ticker.toUpperCase()}/distributions`,
        params
      );

      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No distributions found for ${ticker}.` }] };
      }

      // Sort by ex-date DESCENDING (newest first)
      const sorted = [...data].sort(
        (a, b) => new Date(b.exDate).getTime() - new Date(a.exDate).getTime()
      );

      const recent = sorted.slice(0, 20);
      const total = sorted.reduce((acc, d) => acc + Number(d.distribution || 0), 0);
      const avg = sorted.length ? total / sorted.length : 0;
      const latestFreq = sorted[0]?.distributionFreqency;

      const lines = recent.map(d =>
        `  ${fmtDate(d.exDate)} | $${fmtNum(d.distribution, 4)} | Pay: ${fmtDate(d.paymentDate)} | Decl: ${fmtDate(d.declarationDate)} | Freq: ${freqLabel(d.distributionFreqency)}`
      );

      const header =
        `**${ticker.toUpperCase()}** — Distributions\n` +
        `Records: ${sorted.length} | Total in window: $${total.toFixed(4)} | Avg: $${avg.toFixed(4)} | Latest declared frequency: ${freqLabel(latestFreq)}\n\n` +
        `Showing ${recent.length} most recent (ex-date | amount | payment | declaration | frequency):\n`;

      return { content: [{ type: "text" as const, text: header + lines.join("\n") }] };
    }
  );

  // ── Distribution yield (trailing 1-year) ─────────────────────────────────
  server.registerTool(
    "tiingo_distribution_yield",
    {
      title: "Distribution Yield",
      description: `Get the historical trailing 1-year distribution yield timeseries for a stock, ETF, or mutual fund.
Requires Tiingo beta or enterprise entitlement on your token.
Args:
  - ticker (string): Stock/ETF/MF ticker symbol, e.g. "KO", "JEPI", "SCHD"
Returns: Latest yield value, recent history (last 10 dates), and min/max over the available range.`,
      inputSchema: {
        ticker: z.string().min(1).max(10).describe("Stock/ETF/MF ticker symbol")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ ticker }: { ticker: string }) => {
      const data = await tiingoFetch<TiingoDistributionYield[]>(
        `/tiingo/corporate-actions/${ticker.toUpperCase()}/distribution-yield`
      );

      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No distribution yield data for ${ticker}.` }] };
      }

      // Sort by date DESCENDING (newest first)
      const sorted = [...data].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      const numericYields = sorted
        .map(r => Number(r.trailingDiv1Y))
        .filter(n => !Number.isNaN(n));

      const latest = sorted[0];
      const min = numericYields.length ? Math.min(...numericYields) : NaN;
      const max = numericYields.length ? Math.max(...numericYields) : NaN;

      const recent = sorted.slice(0, 10).map(r =>
        `  ${fmtDate(r.date)} | ${Number(r.trailingDiv1Y).toFixed(4)}`
      );

      const header =
        `**${ticker.toUpperCase()}** — Trailing 1Y Distribution Yield\n` +
        `Latest [${fmtDate(latest.date)}]: ${Number(latest.trailingDiv1Y).toFixed(4)}\n` +
        `Range over ${sorted.length} dates: ${min.toFixed(4)} → ${max.toFixed(4)}\n\n` +
        `Last 10 observations:\n`;

      return { content: [{ type: "text" as const, text: header + recent.join("\n") }] };
    }
  );

  // ── Splits ───────────────────────────────────────────────────────────────
  server.registerTool(
    "tiingo_splits",
    {
      title: "Stock Splits",
      description: `Get split history (and announced future splits) for a stock, ETF, or mutual fund. Includes reverse splits and cancelled splits.
Requires Tiingo beta or enterprise entitlement on your token.
Args:
  - ticker (string): Stock/ETF/MF ticker symbol, e.g. "NVDA", "TSLA"
  - startExDate (string): Start ex-date YYYY-MM-DD (optional; default returns full history)
  - endExDate (string): End ex-date YYYY-MM-DD (optional)
Returns: All splits in window, sorted newest first, with ratios and status (active vs cancelled).`,
      inputSchema: {
        ticker: z.string().min(1).max(10).describe("Stock/ETF/MF ticker symbol"),
        startExDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start ex-date YYYY-MM-DD"),
        endExDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End ex-date YYYY-MM-DD")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ ticker, startExDate, endExDate }: { ticker: string; startExDate?: string; endExDate?: string }) => {
      const params: Record<string, string> = {};
      if (startExDate) params["startExDate"] = startExDate;
      if (endExDate) params["endExDate"] = endExDate;

      const data = await tiingoFetch<TiingoSplit[]>(
        `/tiingo/corporate-actions/${ticker.toUpperCase()}/splits`,
        params
      );

      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No split events found for ${ticker}.` }] };
      }

      // Sort by ex-date DESCENDING
      const sorted = [...data].sort(
        (a, b) => new Date(b.exDate).getTime() - new Date(a.exDate).getTime()
      );

      const lines = sorted.map(s => {
        const status = s.splitStatus === "a" ? "Active" : s.splitStatus === "c" ? "Cancelled" : s.splitStatus;
        const reverse = s.splitFactor < 1 ? " (REVERSE)" : "";
        return `  ${fmtDate(s.exDate)} | ${s.splitTo}-for-${s.splitFrom} (factor ${s.splitFactor})${reverse} | ${status}`;
      });

      const active = sorted.filter(s => s.splitStatus === "a").length;
      const cancelled = sorted.filter(s => s.splitStatus === "c").length;

      const header =
        `**${ticker.toUpperCase()}** — Splits\n` +
        `Events: ${sorted.length} (${active} active, ${cancelled} cancelled)\n\n` +
        `Newest first (ex-date | ratio | status):\n`;

      return { content: [{ type: "text" as const, text: header + lines.join("\n") }] };
    }
  );
}
