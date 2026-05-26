// src/types.ts

export interface TiingoTickerMeta {
  ticker: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  exchangeCode: string;
}

export interface TiingoDailyPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjOpen: number;
  adjHigh: number;
  adjLow: number;
  adjClose: number;
  adjVolume: number;
  divCash: number;
  splitFactor: number;
}

// IEX TOPS quote, per Tiingo doc. Fields marked "entitled" are null unless
// the user is registered with IEX Exchange and has a market data agreement
// in place (per Feb 1, 2025 IEX policy change).
export interface TiingoIexQuote {
  ticker: string;
  timestamp: string;
  quoteTimestamp: string | null;       // entitled
  lastSaleTimestamp: string | null;    // entitled
  last: number | null;                 // entitled — the actual field name (was incorrectly typed as lastSalePrice)
  lastSize: number | null;             // entitled
  tngoLast: number;                    // Tiingo-derived, always available
  prevClose: number;
  open: number;
  high: number;
  low: number;
  mid: number | null;
  volume: number;
  bidSize: number | null;              // entitled
  bidPrice: number | null;             // entitled
  askSize: number | null;              // entitled
  askPrice: number | null;             // entitled
}

export interface TiingoNewsItem {
  id: number;
  source: string;
  title: string;
  url: string;
  publishedDate: string;
  crawlDate: string;
  description: string;
  tickers: string[];
  tags: string[];
}

// Tiingo /fundamentals/{ticker}/statements rows
export interface TiingoStatementMetric {
  dataCode: string;
  value: number | null;
}

export interface TiingoStatementRow {
  date: string;
  year: number;
  quarter: number;  // 0 = Annual Report, 1-4 = quarterly
  statementData?: {
    incomeStatement?: TiingoStatementMetric[];
    balanceSheet?: TiingoStatementMetric[];
    cashFlow?: TiingoStatementMetric[];
    overview?: TiingoStatementMetric[];
  };
}

// Definitions endpoint (global, no ticker)
export interface TiingoFundamentalDefinition {
  dataCode: string;
  name: string;
  description: string;
  units: string;          // per doc this is `units` (plural), not `unit`
  statementType: string;
}

// Daily fundamentals (P/E, market cap, EV/EBITDA, etc.)
export interface TiingoFundamentalDaily {
  date: string;
  marketCap?: number;
  enterpriseVal?: number;
  peRatio?: number;
  pbRatio?: number;
  trailingPEG1Y?: number;
}

export interface TiingoCryptoTicker {
  ticker: string;
  name: string;
  description: string;
  baseCurrency: string;
  quoteCurrency: string;
}

export interface TiingoCryptoPriceData {
  ticker: string;
  baseCurrency: string;
  quoteCurrency: string;
  priceData: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    volumeNotional: number;
    tradesDone: number;
  }>;
}

// Forex bars come back as a FLAT array, not wrapped.
// Example: GET /tiingo/fx/eurusd/prices → [{date, ticker, open, high, low, close}, ...]
export interface TiingoForexBar {
  date: string;
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
}
