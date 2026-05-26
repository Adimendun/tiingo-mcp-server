// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";

import { registerPriceTools } from "./tools/prices.js";
import { registerNewsTools } from "./tools/news.js";
import { registerFundamentalsTools } from "./tools/fundamentals.js";
import { registerCryptoTools } from "./tools/crypto.js";
import { registerForexTools } from "./tools/forex.js";
import { registerScreenerTools } from "./tools/screener.js";
import { registerCorporateActionsTools } from "./tools/corporate-actions.js";
import { registerUtilitiesTools } from "./tools/utilities.js";

// ── Server factory ───────────────────────────────────────────────────────────
function createServer(): McpServer {
  const server = new McpServer({
    name: "tiingo-mcp-server",
    version: "1.2.0"
  });

  registerPriceTools(server);
  registerNewsTools(server);
  registerFundamentalsTools(server);
  registerCryptoTools(server);
  registerForexTools(server);
  registerScreenerTools(server);
  registerCorporateActionsTools(server);
  registerUtilitiesTools(server);

  return server;
}

// ── HTTP transport (for Railway / remote hosting) ────────────────────────────
async function runHTTP(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Secret path from env var — if set, endpoint becomes /mcp/{secret}
  const secret = process.env.MCP_SECRET_PATH ?? "";
  const mcpPath = secret ? `/mcp/${secret}` : "/mcp";

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "tiingo-mcp-server", version: "1.2.0" });
  });

  app.post(mcpPath, async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT ?? "3000");
  app.listen(port, () => {
    console.error(`Tiingo MCP server running on port ${port}`);
    console.error(`MCP endpoint: http://localhost:${port}${mcpPath}`);
  });
}

// ── stdio transport (for local Claude Desktop / testing) ─────────────────────
async function runStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Tiingo MCP server running via stdio");
}

// ── Entry point ──────────────────────────────────────────────────────────────
const transport = process.env.TRANSPORT ?? "http";
if (transport === "http") {
  runHTTP().catch(err => { console.error(err); process.exit(1); });
} else {
  runStdio().catch(err => { console.error(err); process.exit(1); });
}
