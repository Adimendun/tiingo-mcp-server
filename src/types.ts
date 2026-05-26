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

// IEX TOPS quote, per Tiingo doc. Entitled fields are null without IEX
// market-data agreement (per Feb 1, 2025 IEX policy change).
export interface TiingoIexQuote {
  ticker: string;
  timestamp: string;
  quoteTimestamp: string | null;
  lastSaleTimestamp: string | null;
  last: number | null;
  lastSize: number | null;
  tngoLast: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  mid: number | null;
  volume: number;
  bidSize: number | null;
  bidPrice: number | null;
  askSize: number | null;
  askPrice: number | null;
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

// Fundamentals statements
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

// Definitions endpoint (global)
export interface TiingoFundamentalDefinition {
  dataCode: string;
  name: string;
  description: string;
  units: string;
  statementType: string;
}

// Daily fundamentals
export interface TiingoFundamentalDaily {
  date: string;
  marketCap?: number;
  enterpriseVal?: number;
  peRatio?: number;
  pbRatio?: number;
  trailingPEG1Y?: number;
}

// Fundamentals meta endpoint - per-ticker company classification
export interface TiingoFundamentalMeta {
  permaTicker: string;
  ticker: string;
  name: string;
  isActive: boolean;
  isADR: boolean;
  sector: string | null;
  industry: string | null;
  sicCode: number | null;
  sicSector: string | null;
  sicIndustry: string | null;
  reportingCurrency: string | null;
  location: string | null;
  companyWebsite: string | null;
  secFilingWebsite: string | null;
  statementLastUpdated: string | null;
  dailyLastUpdated: string | null;
}

// Corporate actions — distributions (dividends)
// NOTE: Tiingo doc literally spells the JSON field "distributionFreqency" (typo).
// Keep that exact spelling — it's what the API returns.
export interface TiingoDistribution {
  permaTicker: string;
  ticker: string;
  exDate: string;
  paymentDate: string | null;
  recordDate: string | null;
  declarationDate: string | null;
  distribution: number;
  distributionFreqency: string;  // sic — Tiingo's field name has a typo
}

// Distribution yield timeseries
export interface TiingoDistributionYield {
  date: string;
  trailingDiv1Y: number | string;
}

// Corporate actions — splits
export interface TiingoSplit {
  permaTicker: string;
  ticker: string;
  exDate: string;
  splitFrom: number;
  splitTo: number;
  splitFactor: number;
  splitStatus: "a" | "c";   // a = Active, c = Cancelled
}

// Search results
export interface TiingoSearchResult {
  ticker: string;
  name: string;
  assetType: string;       // Stock | ETF | Mutual Fund
  isActive: boolean;
  permaTicker: string;
  openFIGI: string | null;
}

// Crypto
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

// Forex bars come back as a flat array (not wrapped, unlike crypto)
export interface TiingoForexBar {
  date: string;
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

// Human-readable mapping of Tiingo's distribution frequency codes
export const DISTRIBUTION_FREQUENCY: Record<string, string> = {
  w: "Weekly",
  bm: "Bimonthly",
  m: "Monthly",
  tm: "Trimesterly",
  q: "Quarterly",
  sa: "Semiannually",
  a: "Annually",
  ir: "Irregular",
  f: "Final",
  u: "Unspecified",
  c: "Cancelled"
};
