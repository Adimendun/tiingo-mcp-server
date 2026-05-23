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

// ── Server factory ───────────────────────────────────────────────────────────
function createServer(): McpServer {
  const server = new McpServer({
    name: "tiingo-mcp-server",
    version: "1.0.0"
  });

  registerPriceTools(server);
  registerNewsTools(server);
  registerFundamentalsTools(server);
  registerCryptoTools(server);
  registerForexTools(server);

  return server;
}

// ── HTTP transport (for Railway / remote hosting) ────────────────────────────
async function runHTTP(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Health check for Railway
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "tiingo-mcp-server", version: "1.0.0" });
  });

  app.post("/mcp", async (req, res) => {
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
    console.error(`MCP endpoint: http://localhost:${port}/mcp`);
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
