# Tiingo MCP Server — Phase 1 Audit Report

**Scope:** Validation of the 11 implemented endpoints against the official Tiingo REST API documentation (10 HTML doc pages).
**Baseline version:** 1.1.1 (post-Phase-0 fixes for the fundamentals NaN bug and adjacent issues).
**Method:** doc-by-doc field comparison + live API calls where ambiguity remained.

---

## Summary

| Endpoint | Status | Findings |
|---|---|---|
| `/tiingo/daily/{ticker}` (meta) | ✅ Clean | No issues |
| `/tiingo/daily/{ticker}/prices` (EOD) | ✅ Clean | No issues |
| `/iex` (realtime quote) | ⚠️ Type drift | `lastSalePrice` field doesn't exist in API (should be `last`); not used at runtime so silent |
| `/iex/{ticker}/prices` (intraday) | 🔴 Broken | `volume` field requires explicit `columns` request param — without it, volume always shows `NaN` |
| `/tiingo/news` | 🟡 Missing param | `sortBy` (publishedDate vs crawlDate) not exposed |
| `/tiingo/fundamentals/definitions` | 🔴 Broken | Code calls per-ticker URL which returns 404. Confirmed live. Tool never works. |
| `/tiingo/fundamentals/{ticker}/statements` | ✅ Fixed in v1.1.1 | Verified against doc — fix is correct |
| `/tiingo/fundamentals/{ticker}/daily` | ✅ Clean | No issues |
| `/tiingo/crypto/prices` | ✅ Clean | No issues |
| `/tiingo/crypto/top` | 🟠 Deprecated | Tiingo officially deprecated this endpoint. May return null/limited data. |
| `/tiingo/fx/prices` | 🔴 Broken | Code uses wrong URL pattern and wrong response shape. Confirmed live (returns 27× "No price data") |
| `/tiingo/fx/top` | ✅ Fixed in v1.1.1 | `mid` → `midPrice` fix verified against doc |

**Net new bugs found in Phase 1: 4 critical + 1 deprecation + 1 missing param + 1 type drift.**

---

## Critical bugs — confirmed live

### A1. `tiingo_fundamentals_definitions` always returns 404

**File:** `src/tools/fundamentals.ts`

The code calls:
```
GET /tiingo/fundamentals/{ticker}/definitions
```

But per the Tiingo doc, the definitions endpoint is GLOBAL — there's no per-ticker variant:
```
GET /tiingo/fundamentals/definitions
```

Definitions describe the universe of available metrics; they don't vary by ticker. Confirmed with a live call: `Tiingo API error 404`.

**Impact:** This tool has never worked. Anyone calling it gets a 404.

**Fix:**
- Drop the `ticker` parameter from the input schema
- Change URL to `/tiingo/fundamentals/definitions`

### A2. `tiingo_fundamentals_definitions` reads wrong field name for units

Same file. The code reads `i.unit` (singular), but the doc says the field is `units` (plural). Result: the units column always displays `—`.

**Impact:** Cosmetic when A1 is fixed; invisible while A1 keeps the tool dead.

### A3. `tiingo_prices_intraday` shows volume as NaN

**File:** `src/tools/prices.ts`

The IEX intraday prices doc has this explicit warning:

> Volume (`volume`): This value will only be exposed if explicitly passed to the `columns` request parameter. E.g. `?columns=open,high,low,close,volume`.

The current code doesn't pass `columns`, so `volume` is always undefined → `Number(undefined).toLocaleString()` → `NaN`.

**Impact:** Volume column is broken for every intraday call.

**Fix:** Add `columns: "open,high,low,close,volume"` to the request params.

### A4. `tiingo_forex_prices` returns "No price data" for every bar

**File:** `src/tools/forex.ts` (also affects `tiingo_usdmxn` in `screener.ts`)

The code calls `/tiingo/fx/prices?tickers=...` expecting a response shape of:
```json
[{ "ticker": "eurusd", "baseCurrency": "...", "priceData": [...] }]
```

But the actual response from this endpoint is a **flat array of bars**:
```json
[{ "date": "2026-05-25", "ticker": "eurusd", "open": 1.08, "high": ..., ... }]
```

The code's `.map(item => item.priceData)` therefore iterates 27 individual bars and reports "No price data" 27 times.

The forex API differs from the crypto API in shape:
- **Crypto** `/crypto/prices?tickers=...` → wrapped: `{ticker, priceData: [...]}`
- **Forex** `/fx/prices?tickers=...` → flat: `[{date, ticker, ohlc...}]`

The doc URL pattern for forex is also different — it shows ticker IN THE PATH (`/fx/{ticker}/prices`) for single-ticker, with no multi-ticker via query documented.

**Impact:** Both `tiingo_forex_prices` and `tiingo_usdmxn` return empty data. Confirmed live with eurusd.

**Fix:** Use the documented single-ticker-in-path URL, loop with `Promise.all` for multiple tickers, parse the flat response.

---

## High severity — needs attention

### B1. `tiingo_crypto_realtime` calls a deprecated endpoint

**File:** `src/tools/crypto.ts`

The Tiingo crypto doc has an explicit deprecation warning for `/tiingo/crypto/top`:

> Deprecation Warning: After much consideration, we have made the decision to deprecate the top-of-book endpoint... If you need last price, that is available on the /prices endpoint described in the above section.

The endpoint may still return data in a degraded state, or break at any time.

**Recommended action:** add a note to the tool description warning about deprecation, and offer last-price-only fallback via `/crypto/prices` with `resampleFreq=1min`. Don't remove yet — for users with IEX-style entitlements it may still return bid/ask.

---

## Medium severity

### C1. `tiingo_news` doesn't expose `sortBy`

The news doc documents a `sortBy` query param with values `publishedDate` (default) and `crawlDate`. Currently not exposed. Useful for sorting by when Tiingo crawled the article vs when it was originally published.

### C2. `TiingoIexQuote` type has phantom `lastSalePrice` / `lastSize` fields

Per the IEX doc, the actual field names are `last` and `lastSize`. Our type has `lastSalePrice` which doesn't exist. Code at runtime uses `tngoLast` (which is correct), so the misnamed field is never touched — silent but misleading.

---

## Verified correct (no change needed)

- EOD prices fields: `date, open, high, low, close, volume, adjOpen, adjHigh, adjLow, adjClose, adjVolume, divCash, splitFactor` — all match
- Meta endpoint fields: `ticker, name, exchangeCode, description, startDate, endDate` — all match
- IEX quote fields used at runtime: `ticker, tngoLast, prevClose, bidPrice, askPrice, bidSize, askSize, volume, timestamp` — all match
- News fields: `id, title, url, description, publishedDate, crawlDate, source, tickers, tags` — all match
- Crypto prices wrapper: `{ticker, baseCurrency, quoteCurrency, priceData}` — matches doc
- Crypto top fields used at runtime: `topOfBookData[0].lastPrice/bidPrice/askPrice/bidSize/askSize/lastExchange` — all match
- Forex `/fx/top` fields after v1.1.1: `midPrice, bidPrice, askPrice, quoteTimestamp` — confirmed by doc
- Statements response: `{date, year, quarter, statementData: {incomeStatement|balanceSheet|cashFlow|overview: [{dataCode, value}]}}` — the v1.1.1 fix is doc-validated
- Quarter semantics: `0 = Annual Report, 1–4 = quarterly` — confirms my filter is correct
- Daily fundamentals fields: `date, marketCap, enterpriseVal, peRatio, pbRatio, trailingPEG1Y` — match

---

## Permanent-ticker support — informational

Tiingo provides a `permaTicker` concept for delisted/recycled symbols:

> For delisted or recycled symbols, use Tiingo permaTicker (stable identifier)

The fundamentals tools currently only accept active tickers. If you ever need to analyze a delisted name (relevant for historical comparables), you'd want to add permaTicker support. Not urgent. The new `/tiingo/fundamentals/meta` endpoint (not implemented) returns the permaTicker for every covered company.

---

## Subscription tier notes — informational

- **Fundamentals:** "DOW 30 are available for free/evaluation" for 3 years. Full coverage is paid add-on.
- **IEX TOPS feed (bid/ask):** "As of February 1st, 2025 IEX Exchange has changed their market data policies. To receive the FULL TOPS Feed, you must now have a market data agreement signed with the IEX Exchange." Without entitlement, fields `last`, `lastSize`, `lastSaleTimestamp`, `quoteTimestamp`, `bidSize`, `bidPrice`, `askSize`, `askPrice` are null. `tngoLast` is Tiingo-derived and remains available.
- **Forex API:** Doc explicitly states it's "currently in beta." Behavior may change.
