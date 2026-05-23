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

export interface TiingoIexQuote {
  ticker: string;
  timestamp: string;
  lastSalePrice: number;
  lastSize: number;
  tngoLast: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  mid: number;
  volume: number;
  bidSize: number;
  bidPrice: number;
  askSize: number;
  askPrice: number;
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

export interface TiingoFundamental {
  date: string;
  year: number;
  quarter: number;
  statementType: string;
  [key: string]: unknown;
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

export interface TiingoForexPair {
  ticker: string;
  baseCurrency: string;
  quoteCurrency: string;
}

export interface TiingoForexPrice {
  ticker: string;
  baseCurrency: string;
  quoteCurrency: string;
  priceData: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
}
