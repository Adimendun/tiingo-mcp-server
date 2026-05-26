// src/tools/utilities.ts
//
// Utility endpoints — currently just Search.
// Tiingo doc note: "Search Endpoint has just been launched and is in early
// beta. Responses objects are subject to change. We do not recommend building
// production code using this endpoint while in beta."
//
// We expose it anyway because it's genuinely useful for resolving company
// names to tickers. The user should know it's beta — the tool description
// says so.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tiingoFetch } from "../services/tiingo.js";
import type { TiingoSearchResult } from "../types.js";

export function registerUtilitiesTools(server: McpServer): void {

  server.registerTool(
    "tiingo_search",
    {
      title: "Search Tickers",
      description: `Search Tiingo's database for assets by ticker or company name. Useful when you don't remember the exact symbol. Beta endpoint per Tiingo — schema may change.

Args:
  - query (string): Search term — can be a partial ticker, full company name, or fragment, e.g. "apple", "Nvidia", "schwab dividend"
  - activeOnly (boolean): Filter out delisted assets (default: true)
  - assetTypes (string[]): Filter by asset type. Valid: "Stock" | "ETF" | "Mutual Fund". Default: all.
  - limit (number): Max results to display (default: 10, max: 30)
Returns: Matching assets with ticker, name, type, and active/delisted status.`,
      inputSchema: {
        query: z.string().min(1).max(100).describe("Search query (partial ticker or company name)"),
        activeOnly: z.boolean().default(true).describe("Filter out delisted assets"),
        assetTypes: z.array(z.enum(["Stock", "ETF", "Mutual Fund"])).optional().describe("Restrict to these asset types"),
        limit: z.number().int().min(1).max(30).default(10).describe("Max results to display")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ query, activeOnly, assetTypes, limit }: {
      query: string;
      activeOnly: boolean;
      assetTypes?: ("Stock" | "ETF" | "Mutual Fund")[];
      limit: number;
    }) => {
      const data = await tiingoFetch<TiingoSearchResult[]>(
        `/tiingo/utilities/search`,
        { query }
      );

      if (!data.length) {
        return { content: [{ type: "text" as const, text: `No matches for "${query}".` }] };
      }

      // Apply filters client-side (Tiingo's search filtering capabilities are not
      // formally documented; safer to filter on our side).
      let filtered = data;
      if (activeOnly) {
        filtered = filtered.filter(r => r.isActive !== false);
      }
      if (assetTypes && assetTypes.length > 0) {
        const allowed = new Set(assetTypes);
        filtered = filtered.filter(r => r.assetType && allowed.has(r.assetType as "Stock" | "ETF" | "Mutual Fund"));
      }

      if (!filtered.length) {
        return { content: [{ type: "text" as const, text: `${data.length} matches for "${query}", but none passed the active/assetType filters.` }] };
      }

      const shown = filtered.slice(0, limit);
      const lines = shown.map(r => {
        const flag = r.isActive === false ? " [DELISTED]" : "";
        const type = r.assetType || "—";
        const perma = r.permaTicker ? ` (perma: ${r.permaTicker})` : "";
        return `  **${r.ticker}**${flag} — ${r.name} [${type}]${perma}`;
      });

      const truncated = filtered.length > shown.length
        ? `\n\n(${filtered.length - shown.length} more matches not shown; raise \`limit\` to see them)`
        : "";

      return {
        content: [{ type: "text" as const, text: `Search "${query}" — ${filtered.length} matches\n\n${lines.join("\n")}${truncated}` }]
      };
    }
  );
}
