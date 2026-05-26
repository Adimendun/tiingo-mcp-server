// src/tools/fundamentals.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tiingoFetch } from "../services/tiingo.js";

export function registerFundamentalsTools(server: McpServer): void {

  // ── Fundamentals definitions (available metrics) ─────────────────────────
  server.registerTool(
    "tiingo_fundamentals_definitions",
    {
      title: "Fundamentals Definitions",
      description: `List all available fundamental financial metrics and their definitions for a given ticker.
Args:
  - ticker (string): Stock ticker symbol, e.g. "AAPL"
Returns: List of available fundamental metric names and descriptions`,
      inputSchema: {
        ticker: z.string().min(1).max(10).describe("Stock ticker symbol")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ ticker }: { ticker: string }) => {
      const data = await tiingoFetch<Array<{ dataCode: string; name: string; description: string; unit: string; statementType: string }>>(
        `/tiingo/fundamentals/${ticker.toUpperCase()}/definitions`
      );

      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No fundamentals definitions available for ${ticker}.` }] };
      }

      const byStatement = data.reduce<Record<string, typeof data>>((acc, item) => {
        const key = item.statementType ?? "other";
        (acc[key] ??= []).push(item);
        return acc;
      }, {});

      const lines = Object.entries(byStatement).map(([stmt, items]) =>
        `**${stmt.toUpperCase()}**\n` + items.map(i => `  - ${i.dataCode}: ${i.name} (${i.unit ?? "—"})`).join("\n")
      );

      return {
        content: [{ type: "text" as const, text: `Fundamental metrics for **${ticker.toUpperCase()}** (${data.length} total)\n\n${lines.join("\n\n")}` }],
        // structured
      };
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

      const data = await tiingoFetch<Array<Record<string, unknown>>>(`/tiingo/fundamentals/${ticker.toUpperCase()}/statements`, params);

      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No fundamentals data found for ${ticker}.` }] };
      }

      // Debug: show raw JSON of first record to understand structure
      const firstRow = data[0];
      const rawKeys = Object.keys(firstRow).join(", ");
      const rawSample = JSON.stringify(firstRow, null, 2).slice(0, 3000);

      // Show last 4 periods for readability
      const recent = data.slice(-4);
      const text = `**${ticker.toUpperCase()}** — ${statementType} (${frequency})\nPeriods: ${data.length} total | Showing last ${recent.length}\n\n` +
        recent.map(row => {
          const date = String(row["date"] ?? row["year"] ?? "").slice(0, 10);
          const quarter = row["quarter"] ? `Q${row["quarter"]}` : "";

          // Tiingo nests data under the statement type key (e.g. "incomeStatement", "balanceSheet", "cashFlow")
          const metaKeys = ["date", "year", "quarter", "statementType"];
          const dataKey = Object.keys(row).find(k => !metaKeys.includes(k));
          const stmtData = dataKey ? row[dataKey] : undefined;
          let entries = "";

          if (Array.isArray(stmtData)) {
            // Array of { dataCode, value } objects
            entries = stmtData
              .slice(0, 25)
              .map((item: Record<string, unknown>) => {
                const code = String(item["dataCode"] ?? item["name"] ?? "unknown");
                const val = item["value"];
                const formatted = val !== null && val !== undefined ? Number(val).toLocaleString() : "—";
                return `  ${code}: ${formatted}`;
              })
              .join("\n");
          } else if (stmtData && typeof stmtData === "object") {
            // Object with dataCode keys
            entries = Object.entries(stmtData as Record<string, unknown>)
              .slice(0, 25)
              .map(([k, v]) => {
                const val = typeof v === "object" && v !== null ? (v as Record<string, unknown>)["value"] ?? v : v;
                const formatted = val !== null && val !== undefined ? Number(val).toLocaleString() : "—";
                return `  ${k}: ${formatted}`;
              })
              .join("\n");
          } else {
            // Flat structure fallback
            entries = Object.entries(row)
              .filter(([k]) => !["date", "year", "quarter", "statementType"].includes(k))
              .slice(0, 25)
              .map(([k, v]) => `  ${k}: ${v !== null && v !== undefined ? String(v) : "—"}`)
              .join("\n");
          }

          return `**${date} ${quarter}**\n${entries}`;
        }).join("\n\n---\n\n");

      const debugText = `\n\n---\n**DEBUG — Raw keys:** ${rawKeys}\n**First record sample:**\n\`\`\`json\n${rawSample}\n\`\`\``;
      return {
        content: [{ type: "text" as const, text: text + debugText }],
        // structured
      };
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

      const data = await tiingoFetch<Array<Record<string, unknown>>>(`/tiingo/fundamentals/${ticker.toUpperCase()}/daily`, params);

      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No daily fundamentals available for ${ticker}.` }] };
      }

      const latest = data[data.length - 1];
      const keys = Object.keys(latest).filter(k => k !== "date");
      const lines = keys.map(k => `  ${k}: ${latest[k] !== null ? String(latest[k]) : "—"}`).join("\n");

      const text = `**${ticker.toUpperCase()}** — Daily Fundamentals\nDate: ${String(latest["date"]).slice(0, 10)} (latest of ${data.length} days)\n\n${lines}`;
      return {
        content: [{ type: "text" as const, text }],
        // structured
      };
    }
  );
}
