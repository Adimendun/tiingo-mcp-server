# tiingo-mcp-server

MCP server for [Tiingo](https://tiingo.com) financial data API. Exposes stock prices, real-time quotes, fundamentals, news, crypto, and forex data to Claude.

## Tools

| Tool | Description |
|------|-------------|
| `tiingo_ticker_meta` | Company name, exchange, data range |
| `tiingo_prices_eod` | Adjusted EOD OHLCV (daily/weekly/monthly) |
| `tiingo_quote_realtime` | Real-time IEX quotes (bid/ask/last) |
| `tiingo_prices_intraday` | Intraday bars (1min–1hour) |
| `tiingo_news` | News filtered by ticker and/or tags |
| `tiingo_fundamentals_definitions` | List available fundamental metrics |
| `tiingo_fundamentals_statements` | Income statement, balance sheet, cash flow |
| `tiingo_fundamentals_daily` | Daily valuation metrics (P/E, EV, market cap) |
| `tiingo_crypto_prices` | Crypto OHLCV history |
| `tiingo_crypto_realtime` | Real-time crypto top-of-book |
| `tiingo_forex_prices` | Forex pair OHLC history |
| `tiingo_forex_realtime` | Real-time forex bid/ask/mid |

---

## Deploy to Railway

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
gh repo create tiingo-mcp-server --public --push
```

### 2. Create Railway project

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
2. Select your `tiingo-mcp-server` repo
3. Railway will auto-detect Node.js

### 3. Set environment variable

In Railway → your service → Variables:

```
TIINGO_TOKEN=your_actual_tiingo_api_token
TRANSPORT=http
```

### 4. Verify deployment

```bash
curl https://your-app.railway.app/health
# → {"status":"ok","server":"tiingo-mcp-server","version":"1.0.0"}
```

### 5. Connect to Claude.ai

1. Go to [claude.ai](https://claude.ai) → Settings → Connectors
2. Add custom connector
3. URL: `https://your-app.railway.app/mcp`
4. Save → Done

---

## Local Development

```bash
npm install
npm run build

# Run locally (HTTP mode)
TIINGO_TOKEN=your_token TRANSPORT=http npm start

# Test with MCP Inspector
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

---

## Notes

- All endpoints are read-only — no write operations
- Token is stored server-side and never exposed to the browser
- Intraday and real-time data require a Tiingo subscription that includes IEX data
