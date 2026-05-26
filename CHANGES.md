# Changes — tiingo-mcp-server v1.1.2

Version: 1.1.1 → 1.1.2

## Context

This is the Phase 1 audit fix: discrepancies found by validating the implemented endpoints **against the official Tiingo documentation**, not against runtime symptoms. See `AUDIT_PHASE_1.md` for the full report.

## Files changed (relative to v1.1.1)

- `src/tools/fundamentals.ts` — fix definitions URL + field name
- `src/tools/prices.ts` — fix intraday URL + add columns param
- `src/tools/forex.ts` — fix URL pattern + response shape
- `src/tools/screener.ts` — apply same forex fix to USD/MXN tool
- `src/tools/news.ts` — expose sortBy param
- `src/tools/crypto.ts` — mark realtime as deprecated
- `src/types.ts` — correct IEX quote field names
- `package.json` — version bump

## Files NOT changed (verified correct in Phase 1)

- `src/index.ts`
- `src/services/tiingo.ts`
- `tsconfig.json`

## Bugs fixed

### 1. CRITICAL — `tiingo_fundamentals_definitions` always returned 404

The doc shows the definitions endpoint is **global** (no ticker in URL):
`GET /tiingo/fundamentals/definitions`

The code was calling `GET /tiingo/fundamentals/{ticker}/definitions`, which doesn't exist. Confirmed live: returns HTTP 404.

**Fix:**
- Dropped `ticker` from the input schema (the tool now takes no arguments)
- Changed URL to the global endpoint

### 2. CRITICAL — Definitions units always displayed as "—"

The code read `i.unit` (singular) but per Tiingo doc the field is `units` (plural). The units column would have shown dashes for every metric once bug #1 was fixed.

**Fix:** changed to `i.units`. The type `TiingoFundamentalDefinition` in `types.ts` now also uses `units`.

### 3. CRITICAL — `tiingo_prices_intraday` showed NaN for volume

The IEX intraday docs include this warning:

> Volume (`volume`): This value will only be exposed if explicitly passed to the `columns` request parameter. E.g. `?columns=open,high,low,close,volume`.

The code didn't pass `columns`, so `volume` was undefined in every bar.

**Fix:** added `columns: "open,high,low,close,volume"` to request params. Also added a null-guard in the formatter so missing volume renders as "—" instead of "NaN" if the field ever changes again.

### 4. CRITICAL — `tiingo_prices_intraday` used wrong URL

Per doc:
- `/iex/{ticker}` = current top-of-book quote
- `/iex/{ticker}/prices` = historical intraday bars

The code hit the first URL with `startDate`/`resampleFreq` params. Tiingo may have been forgiving and returned bars, but the documented URL for intraday is `/prices`.

**Fix:** appended `/prices` to the URL.

### 5. CRITICAL — `tiingo_forex_prices` and `tiingo_usdmxn` returned empty data

Confirmed live with eurusd: the tool returned 27 lines of "No price data".

Two compounding problems:

1. The code called `/tiingo/fx/prices?tickers=eurusd` (multi-ticker query). The doc only documents `/tiingo/fx/{ticker}/prices` (single ticker in path) for historical forex.

2. The code assumed responses are wrapped in `{ticker, baseCurrency, priceData: [...]}`. The actual response is a **flat array of bars** `[{date, ticker, open, high, low, close}, ...]`. Note this is **different from crypto**, which IS wrapped — easy mistake.

**Fix:**
- URL changed to documented single-ticker path
- Multi-ticker support implemented via `Promise.all` over per-ticker calls
- Type updated: new `TiingoForexBar` flat-bar interface
- Same fix applied to `tiingo_usdmxn` in `screener.ts`
- Old `TiingoForexPrice` / `TiingoForexPair` wrapper types removed from `types.ts`

### 6. HIGH — `tiingo_crypto_realtime` calls a deprecated endpoint

Tiingo officially deprecated `/tiingo/crypto/top` due to unreliable bid/ask data across the 60+ crypto exchanges they aggregate. The endpoint may return null/degraded data or stop working entirely.

**Fix:** flagged the tool as deprecated in the title and description, pointing users toward `tiingo_crypto_prices` with `resampleFreq=1min` for last-price-only use cases. Did not remove the tool — for users who don't need bid/ask, last price may still come through.

### 7. MEDIUM — News `sortBy` param exposed

Tiingo's news endpoint accepts `sortBy=publishedDate` (default) or `sortBy=crawlDate`. The latter is useful for surfacing what Tiingo's crawler picked up most recently (vs what was originally published).

**Fix:** added `sortBy` to the input schema and passed it through.

### 8. MEDIUM — `TiingoIexQuote` type drift

The type had `lastSalePrice: number` and `lastSize: number` as required. Per doc, the actual field name is `last` (not `lastSalePrice`), and both are entitled fields that come back null without an IEX market data agreement.

**Fix:** type now matches doc — added `last`, `quoteTimestamp`, `lastSaleTimestamp`; marked entitled fields as nullable. Note that this is a documentation/type-hygiene fix only — runtime code reads `tngoLast` (which is always populated) so user-visible behavior is unchanged.

## Deploy steps

```bash
# In your local clone
git checkout -b fix/phase-1-doc-audit
# overlay the 8 changed files
git add -A
git commit -m "fix(phase-1): doc-validated fixes for definitions, intraday, forex, news, crypto"
git push origin fix/phase-1-doc-audit
# merge or push to main; Railway redeploys
```

After deploy, `/health` should return `version: "1.1.2"`. Quick smoke tests:

1. `tiingo_fundamentals_definitions` (no args) → should return a long catalog grouped by statement type, with real units
2. `tiingo_forex_prices` for `["eurusd"]` → should return a real OHLC summary
3. `tiingo_prices_intraday` for `AAPL` → volume column should show real numbers
4. `tiingo_news` with `sortBy: "crawlDate"` → header should say "sorted by crawlDate"

## What's NOT in this fix (deferred)

- The 4 extra endpoints from the docs (Search, Dividends, Splits, Fund Fees) — Phase 2 decision
- permaTicker support for delisted symbols — informational note in audit
- `/tiingo/fundamentals/meta` endpoint (sector/industry/SIC/permaTicker per ticker) — not implemented; high-value addition for stock-analysis workflows
