// src/tools/fundamentals.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tiingoFetch } from "../services/tiingo.js";
import type { TiingoFundamentalMeta } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Tiingo's /fundamentals/{ticker}/statements endpoint returns rows shaped like:
//
//   {
//     date: "2026-03-31",
//     year: 2026,
//     quarter: 1,                         // 0 = Annual Report, 1-4 = quarterly
//     statementData: {
//       incomeStatement | balanceSheet | cashFlow | overview:
//         Array<{ dataCode: string; value: number | null }>
//     }
//   }
//
// Behaviors confirmed against docs + live testing:
//   - Rows arrive date-DESCENDING (newest first). slice(-N) gives the OLDEST N.
//   - With frequency=quarterly, Tiingo also includes the fiscal-year aggregate
//     for Q4-end dates, with quarter=0. Filter it out for cleanliness.
//   - Definitions endpoint is GLOBAL (no ticker in URL). Per-ticker returns 404.
//   - Meta endpoint is GLOBAL with optional `tickers=` filter for company
//     classification (sector, industry, SIC, isADR, permaTicker, etc.).
// ─────────────────────────────────────────────────────────────────────────────

interface StatementMetric {
  dataCode: string;
  value: number | null;
}

interface StatementRow {
  date: string;
  year: number;
  quarter: number;
  statementData?: Record<string, StatementMetric[]>;
}

interface DefinitionItem {
  dataCode: string;
  name: string;
  description: string;
  units: string;
  statementType: string;
}

const DEBUG = process.env.TIINGO_MCP_DEBUG === "1";

function pivotMetrics(metrics: StatementMetric[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const m of metrics) {
    if (m && typeof m.dataCode === "string") {
      out[m.dataCode] = m.value;
    }
  }
  return out;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) < 100 && !Number.isInteger(n)) return n.toFixed(4);
  return n.toLocaleString();
}

function periodLabel(row: StatementRow): string {
  const date = String(row.date ?? "").slice(0, 10);
  const tag = row.quarter && row.quarter >= 1 && row.quarter <= 4
    ? `Q${row.quarter}`
    : "FY";
  return `${date} ${tag}`;
}

export function registerFundamentalsTools(server: McpServer): void {

  // ── Fundamentals definitions (global; ticker-agnostic) ───────────────────
  server.registerTool(
    "tiingo_fundamentals_definitions",
    {
      title: "Fundamentals Definitions",
      description: `List all available fundamental financial metrics and their definitions.
This is a global catalog — the same definitions apply to every ticker covered by Tiingo.
No arguments required.
Returns: List of metric names and descriptions, grouped by statement type.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async () => {
      const data = await tiingoFetch<DefinitionItem[]>(
        `/tiingo/fundamentals/definitions`
      );

      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No fundamentals definitions returned by Tiingo.` }] };
      }

      const byStatement = data.reduce<Record<string, DefinitionItem[]>>((acc, item) => {
        const key = item.statementType ?? "other";
        (acc[key] ??= []).push(item);
        return acc;
      }, {});

      const lines = Object.entries(byStatement).map(([stmt, items]) =>
        `**${stmt.toUpperCase()}**\n` + items.map(i => `  - ${i.dataCode}: ${i.name} (${i.units || "—"})`).join("\n")
      );

      return {
        content: [{ type: "text" as const, text: `Fundamental metrics (${data.length} total)\n\n${lines.join("\n\n")}` }]
      };
    }
  );

  // ── Fundamentals meta (company classification) ───────────────────────────
  // NEW in v1.2.0. Returns sector/industry/SIC/isADR/permaTicker for each
  // ticker. Useful for stock-analysis workflows where you want to categorize
  // companies before drilling into financials.
  //
  // The Tiingo doc shows a global endpoint `/tiingo/fundamentals/meta`. We
  // pass `tickers=` as a query param to filter server-side, and also filter
  // client-side as a safety net in case the server returns more than requested.
  server.registerTool(
    "tiingo_fundamentals_meta",
    {
      title: "Fundamentals Meta",
      description: `Get company classification metadata (sector, industry, SIC, isADR, permaTicker, location) for one or more tickers.
Useful for grouping/screening companies before pulling their financials.
Args:
  - tickers (string[]): 1-15 ticker symbols, e.g. ["AAPL", "MSFT", "TSM"]
Returns: One row per ticker with sector, industry, SIC, isADR flag, reporting currency, location, and last-updated timestamps.`,
      inputSchema: {
        tickers: z.array(z.string().min(1).max(10)).min(1).max(15).describe("Ticker symbols (1-15)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ tickers }: { tickers: string[] }) => {
      const upper = tickers.map(t => t.toUpperCase());
      const data = await tiingoFetch<TiingoFundamentalMeta[]>(
        `/tiingo/fundamentals/meta`,
        { tickers: upper.join(",") }
      );

      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No meta data found for: ${upper.join(", ")}` }] };
      }

      // Filter client-side as safety net + preserve requested order
      const requested = new Set(upper);
      const byTicker = new Map<string, TiingoFundamentalMeta>();
      for (const row of data) {
        const t = String(row.ticker ?? "").toUpperCase();
        if (requested.has(t)) byTicker.set(t, row);
      }

      const lines = upper.map(t => {
        const m = byTicker.get(t);
        if (!m) return `**${t}**: not found`;

        const adr = m.isADR ? " (ADR)" : "";
        const active = m.isActive ? "" : " [DELISTED]";
        const sector = m.sector || m.sicSector || "—";
        const industry = m.industry || m.sicIndustry || "—";
        const sic = m.sicCode ? ` | SIC ${m.sicCode}` : "";
        const loc = m.location ? ` | ${m.location}` : "";
        const curr = m.reportingCurrency ? ` | Reports in ${m.reportingCurrency}` : "";
        const stmtUpd = m.statementLastUpdated ? String(m.statementLastUpdated).slice(0, 10) : "—";

        return `**${t}**${adr}${active} — ${m.name}\n` +
               `  Sector: ${sector} | Industry: ${industry}${sic}\n` +
               `  PermaTicker: ${m.permaTicker}${loc}${curr}\n` +
               `  Statement last updated: ${stmtUpd}`;
      });

      return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
    }
  );

  // ── Fundamentals statements (actual data) ────────────────────────────────
  server.registerTool(
    "tiingo_fundamentals_statements",
    {
      title: "Fundamentals Statements",
      description: `Get financial statement data (income statement, balance sheet, cash flow) for a stock. Can filter by statement type and date range.
Args:
  - ticker (string): Stock ticker symbol, e.g. "AAPL"
  - statementType (string): "incomeStatement" | "balanceSheet" | "cashFlow" | "overview" (default: "overview")
  - startDate (string): Start date YYYY-MM-DD (optional, default: 2 years ago)
  - endDate (string): End date YYYY-MM-DD (optional, default: today)
  - frequency (string): "annual" | "quarterly" (default: "quarterly")
Returns: Financial statement data rows with metric values`,
      inputSchema: {
        ticker: z.string().min(1).max(10).describe("Stock ticker symbol"),
        statementType: z.enum(["incomeStatement", "balanceSheet", "cashFlow", "overview"]).default("overview").describe("Financial statement type"),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date YYYY-MM-DD"),
        frequency: z.enum(["annual", "quarterly"]).default("quarterly").describe("Reporting frequency")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ ticker, statementType, startDate, endDate, frequency }: {
      ticker: string;
      statementType: "incomeStatement" | "balanceSheet" | "cashFlow" | "overview";
      startDate?: string;
      endDate?: string;
      frequency: "annual" | "quarterly";
    }) => {
      const today = new Date();
      const twoYearsAgo = new Date(today);
      twoYearsAgo.setFullYear(today.getFullYear() - 2);

      const params: Record<string, string> = {
        startDate: startDate ?? twoYearsAgo.toISOString().split("T")[0],
        endDate: endDate ?? today.toISOString().split("T")[0],
        statementType,
        frequency
      };

      const raw = await tiingoFetch<StatementRow[]>(
        `/tiingo/fundamentals/${ticker.toUpperCase()}/statements`,
        params
      );

      if (!raw.length) {
        return { content: [{ type: "text" as const, text: `No fundamentals data found for ${ticker}.` }] };
      }

      const filtered = frequency === "quarterly"
        ? raw.filter(r => r.quarter >= 1 && r.quarter <= 4)
        : raw;

      const sorted = [...filtered].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      const recent = sorted.slice(0, 4);

      const periods = recent.map(row => {
        const metrics = row.statementData?.[statementType] ?? [];
        if (!metrics.length) {
          return `**${periodLabel(row)}**\n  (no ${statementType} metrics returned)`;
        }
        const pivoted = pivotMetrics(metrics);
        const lines = Object.entries(pivoted)
          .map(([code, value]) => `  ${code}: ${formatValue(value)}`)
          .join("\n");
        return `**${periodLabel(row)}**\n${lines}`;
      }).join("\n\n---\n\n");

      const header =
        `**${ticker.toUpperCase()}** — ${statementType} (${frequency})\n` +
        `Periods: ${sorted.length} total | Showing most recent ${recent.length}\n\n`;

      let body = header + periods;

      if (DEBUG) {
        const firstRow = raw[0];
        const debugText =
          `\n\n---\n**DEBUG — Raw keys:** ${Object.keys(firstRow).join(", ")}\n` +
          `**First record sample:**\n\`\`\`json\n${JSON.stringify(firstRow, null, 2).slice(0, 3000)}\n\`\`\``;
        body += debugText;
      }

      return { content: [{ type: "text" as const, text: body }] };
    }
  );

  // ── Daily fundamental metrics (P/E, EV, etc.) ───────────────────────────
  server.registerTool(
    "tiingo_fundamentals_daily",
    {
      title: "Daily Fundamental Metrics",
      description: `Get daily-frequency fundamental metrics (market cap, P/E ratio, EV/EBITDA, etc.) for a stock.
Args:
  - ticker (string): Stock ticker symbol, e.g. "AAPL"
  - startDate (string): Start date YYYY-MM-DD (default: 90 days ago)
  - endDate (string): End date YYYY-MM-DD (default: today)
Returns: Daily fundamental metrics including valuation ratios`,
      inputSchema: {
        ticker: z.string().min(1).max(10).describe("Stock ticker symbol"),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date YYYY-MM-DD")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ ticker, startDate, endDate }: { ticker: string; startDate?: string; endDate?: string }) => {
      const params: Record<string, string> = {
        startDate: startDate ?? (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().split("T")[0]; })(),
        endDate: endDate ?? new Date().toISOString().split("T")[0]
      };

      const data = await tiingoFetch<Array<Record<string, unknown>>>(
        `/tiingo/fundamentals/${ticker.toUpperCase()}/daily`,
        params
      );

      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No daily fundamentals available for ${ticker}.` }] };
      }

      const sorted = [...data].sort(
        (a, b) => new Date(String(b["date"])).getTime() - new Date(String(a["date"])).getTime()
      );
      const latest = sorted[0];

      const keys = Object.keys(latest).filter(k => k !== "date");
      const lines = keys.map(k => `  ${k}: ${latest[k] !== null && latest[k] !== undefined ? String(latest[k]) : "—"}`).join("\n");

      const text =
        `**${ticker.toUpperCase()}** — Daily Fundamentals\n` +
        `Date: ${String(latest["date"]).slice(0, 10)} (latest of ${data.length} days)\n\n${lines}`;
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
