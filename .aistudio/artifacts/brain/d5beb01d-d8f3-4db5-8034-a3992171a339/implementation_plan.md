# Implementation Plan: Client-Side Market Data & Intelligence for Static GitHub Pages

## 1. Root Cause Summary
When deployed as a static site on GitHub Pages (`https://nalexion.github.io/stockporto-react/`), the Node.js `server.ts` backend (`/api/quotes`, `/api/historical`, `/api/advisor/*`) is not running on the same origin, and cross-origin requests to the preview container are blocked by session authentication. Currently:
- `fetchQuotes()` only falls back to Romanian Fidelis government bond calculation (`buildFallbackFidelisQuotes`), returning empty quotes for stocks and ETFs (such as `EVER.RO`, `TVBETETF.RO`, and international tickers), which causes the table to display cost basis (`avgBuyPrice`) as the current price with `0.00 RON (0.00%)` P&L.
- `fetchHistorical()` returns `[]` on backend failure, causing `PortfolioChart` and `IndexCharts` to show *"Market data not available for this period."*
- `analyzeHoldings()` and `analyzePortfolio()` throw errors when the backend `/api/advisor/*` endpoints are unreachable.

---

## 2. Planned Changes

### A. Resilient Client-Side Live Quotes & Historical Charts (`src/lib/api.ts`)
1. **Fast Failover on Static Hosts**:
   - Detect when running on static hosting (`github.io`) or when `/api/*` fails/times out, and immediately use client-side market data fetchers without long delays.
2. **Multi-Proxy Yahoo Finance v8 Chart Fetcher**:
   - Implement a client-side Yahoo Finance v8 chart fetcher (`https://query1.finance.yahoo.com/v8/finance/chart/{symbol}`) routed through a resilient cascade of CORS proxies (`api.allorigins.win/raw`, `corsproxy.io`, `codetabs.com`) with in-memory session caching to avoid rate limits.
   - Extract real-time `regularMarketPrice`, `currency`, `shortName`, and historical daily OHLC/close series (`timestamp` + `indicators.quote[0].close`) directly from the Yahoo v8 chart payload.
   - Apply Romanian (`ROX` -> `RON` / 100) and UK (`GBp` -> `GBP` / 100) sub-unit currency normalizations matching `server.ts`.
3. **BVB / Romanian Equities & ETFs Support (`EVER.RO`, `TVBETETF.RO`, etc.)**:
   - Port the `KNOWN_PROFILES` metadata lookup (covering BVB blue chips, `EVER.RO`, `TVBETETF.RO`, `PTENGETF.RO`, and major EU/US ETFs) to `src/lib/api.ts` so every client-side quote includes accurate `sector`, `industry`, and company name metadata for the Asset Allocation and Market Segments views.
   - Retain and merge `buildFallbackFidelisQuotes()` so Fidelis government bonds (`R2612A.RO`, etc.) continue to compute dirty/clean prices and YTM seamlessly alongside live equity/ETF quotes.
4. **Client-Side Multi-Currency FX Conversion**:
   - Combine live quotes with `fetchBnrRates()` (which already falls back to Frankfurter ECB rates for `EUR`, `USD`, and `RON`) to compute accurate `convertedPrice` and `fxRate` in the user's selected target currency (`RON`, `EUR`, or `USD`).
   - Support historical FX series (`EURRON=X`, `USDRON=X`, `EURUSD=X`) in `fetchHistorical()` using `fetchFxHistoricalRange()` so multi-currency portfolio charts render accurately on GitHub Pages.

### B. Client-Side Market Intelligence & Portfolio Diagnostics (`src/lib/api.ts`, `.env.example`)
1. **Optional Build-Time Gemini Integration (`@google/genai`)**:
   - When `/api/advisor/analyze` or `/api/advisor/analyze-portfolio` is unavailable and a build-time `VITE_GEMINI_API_KEY` environment variable is configured (e.g., via GitHub Actions repository secrets), invoke `gemini-3-flash-preview` directly from the client using structured JSON output matching `AnalyzeResult` and `PortfolioAnalysisResult`.
   - Document `VITE_GEMINI_API_KEY` in `.env.example` for optional static deployment usage.
2. **Built-In Quantitative & Fundamental Engine Fallback**:
   - When neither the backend nor a build-time Gemini key is present, automatically run a deterministic client-side quantitative analysis engine so Market Intelligence (`AnalysisModal`) and Portfolio Diagnostics (`PortfolioAnalysisModal`) always work out of the box on GitHub Pages:
     - **Position Intelligence (`analyzeHoldings`)**: Evaluates each holding's unrealized return, position weight, holding duration, annualized CAGR, and sector/industry classification (`KNOWN_PROFILES`) to generate structured commentary, fundamental catalysts, risk factors, and a rating (`Accumulate`, `Hold`, `Trim`, or `Rebalance`).
     - **Portfolio Diagnostics (`analyzePortfolio`)**: Computes portfolio-wide Herfindahl-Hirschman Index (HHI) concentration, top-holding weight, currency exposure, asset class mix (Equities, ETFs, Fixed Income/Fidelis, Cash), a 0–100 `diversificationScore`, `riskLevel` (`Low`, `Moderate`, `High`, `Aggressive`), `sectorBreakdown`, `keyRisks`, and actionable `recommendations`.

---

## 3. Verification Plan
- Run `compile_applet` and `lint_applet` to verify zero TypeScript or build errors.
- Verify that `fetchQuotes`, `fetchHistorical`, `analyzeHoldings`, and `analyzePortfolio` seamlessly fall back and return complete, strongly-typed data structures for BVB symbols (`EVER.RO`, `TVBETETF.RO`), Fidelis bonds (`R2612A.RO`), indices (`^BET`, `^GSPC`), and international ETFs.
