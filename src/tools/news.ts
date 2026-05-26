// src/tools/news.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tiingoFetch, defaultStartDate, todayDate } from "../services/tiingo.js";
import type { TiingoNewsItem } from "../types.js";

function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "..." : s;
}

export function registerNewsTools(server: McpServer): void {

  server.registerTool(
    "tiingo_news",
    {
      title: "Financial News",
      description: `Get financial news articles filtered by ticker symbols and/or tags. Returns title, source, date, URL, and description.
Args:
  - tickers (string[]): Optional list of ticker symbols to filter news, e.g. ["AAPL", "NVDA"]
  - tags (string[]): Optional list of tags to filter, e.g. ["earnings", "AI", "energy"]
  - startDate (string): Start date YYYY-MM-DD (default: 7 days ago)
  - endDate (string): End date YYYY-MM-DD (default: today)
  - limit (number): Max articles to return, 1-100 (default: 20)
  - offset (number): Pagination offset (default: 0)
  - sortBy (string): "publishedDate" (default) or "crawlDate". Use crawlDate to surface what Tiingo most recently picked up.
Returns: List of news articles with metadata`,
      inputSchema: {
        tickers: z.array(z.string()).optional().describe("Ticker symbols to filter news"),
        tags: z.array(z.string()).optional().describe("Tags to filter news, e.g. 'earnings', 'dividends'"),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date YYYY-MM-DD"),
        limit: z.number().int().min(1).max(100).default(20).describe("Max articles (default 20)"),
        offset: z.number().int().min(0).default(0).describe("Pagination offset"),
        sortBy: z.enum(["publishedDate", "crawlDate"]).default("publishedDate").describe("Sort by published date or crawl date")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ tickers, tags, startDate, endDate, limit, offset, sortBy }: {
      tickers?: string[];
      tags?: string[];
      startDate?: string;
      endDate?: string;
      limit: number;
      offset: number;
      sortBy: "publishedDate" | "crawlDate";
    }) => {
      const params: Record<string, string | number> = {
        startDate: startDate ?? defaultStartDate(7),
        endDate: endDate ?? todayDate(),
        limit,
        offset,
        sortBy
      };
      if (tickers?.length) params["tickers"] = tickers.map(t => t.toUpperCase()).join(",");
      if (tags?.length) params["tags"] = tags.join(",");

      const data = await tiingoFetch<TiingoNewsItem[]>("/tiingo/news", params);

      if (!data.length) {
        return { content: [{ type: "text" as const, text: "No news articles found for the given filters." }] };
      }

      const lines = data.map((item, i) =>
        `**${i + 1}. ${item.title}**\n` +
        `Source: ${item.source} | ${item.publishedDate?.slice(0, 10)}\n` +
        `Tickers: ${item.tickers?.join(", ") || "—"} | Tags: ${item.tags?.slice(0, 5).join(", ") || "—"}\n` +
        `${truncate(item.description ?? "", 200)}\n` +
        `URL: ${item.url}`
      );

      const header = `**News** — ${params["startDate"]} to ${params["endDate"]} | ${data.length} articles | sorted by ${sortBy}\n\n`;
      return {
        content: [{ type: "text" as const, text: header + lines.join("\n\n---\n\n") }]
      };
    }
  );
}
