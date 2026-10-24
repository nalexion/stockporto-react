# StockPortfolioTracker (v2.3.3)

A full-stack, multi-currency investment portfolio tracker, quantitative analytics platform, and Romanian fiscal/tax dashboard designed for **Bucharest Stock Exchange (BVB)** and **international equity investors**.

---

## Overview & Architecture

**StockPortfolioTracker** is a full-stack web application built with **React 19 + TypeScript** on the frontend and a dedicated **Node.js + Express** server on the backend, backed by **Firebase Authentication** and **Google Cloud Firestore**.

Unlike static browser-only trackers, the dedicated Node.js backend acts as a secure server-side gateway that:
- Fetches real-time quotes and multi-year historical OHLCV candles from **Yahoo Finance** without browser CORS restrictions.
- Synchronizes official daily and historical exchange rates directly from the **National Bank of Romania (BNR)** and the **European Central Bank (ECB)**.
- Scrapes live bond parameters, coupon rates, maturity dates, and clean prices for **Romanian Fidelis Government Bonds (`Titluri de Stat Fidelis`)** directly from the Bucharest Stock Exchange (BVB).
- Executes server-side **Market Intelligence** and **Portfolio Diagnostics** with Google Search grounding while keeping API credentials strictly on the server.

---

## Prerequisites

Before running or deploying this application from a cloned repository, ensure you have the following prerequisites configured:

### 1. Runtime & Build Tools
- **Node.js**: `v20.x` or newer (LTS recommended)
- **npm**: `v10.x` or newer

### 2. Firebase Project (Authentication & Firestore)
- A **Google Firebase** project with:
  - **Firebase Authentication** enabled (Google Sign-In provider enabled).
  - **Cloud Firestore** database provisioned.
  - Security rules deployed from `firestore.rules`.
- Client configuration stored in `firebase-applet-config.json` at the project root:
  ```json
  {
    "apiKey": "YOUR_FIREBASE_API_KEY",
    "authDomain": "YOUR_PROJECT.firebaseapp.com",
    "projectId": "YOUR_PROJECT_ID",
    "storageBucket": "YOUR_PROJECT.appspot.com",
    "messagingSenderId": "YOUR_SENDER_ID",
    "appId": "YOUR_APP_ID",
    "firestoreDatabaseId": "(default)"
  }
  ```

### 3. Environment Variables (`.env`)
- Copy `.env.example` to `.env` in the root directory:
  ```env
  # Required for AI-assisted Market Intelligence and Portfolio Diagnostics
  GEMINI_API_KEY="YOUR_GEMINI_API_KEY"

  # Base URL of the application (defaults to http://localhost:3000 locally)
  APP_URL="http://localhost:3000"
  ```

---

## Complete Capabilities

### 1. Multi-Portfolio & Multi-Currency Valuation
- **Multiple Independent Portfolios**: Create, rename, filter, or aggregate ("All Portfolios") across distinct accounts or strategies.
- **Instant Base Currency Switching**: Toggle the entire workspace in real time between `RON`, `EUR`, and `USD`.
- **Official Central Bank FX Engine**: Automatic conversion using live and historical **BNR** (National Bank of Romania) XML feeds and **ECB** (Frankfurter) historical currency series.
- **Cash & Margin Management**: Track multi-currency cash balances (`RON`, `EUR`, `USD`) per portfolio, including negative balances (margin debt) and net equity adjustments.

### 2. Local (BVB) & International Asset Coverage
- **Bucharest Stock Exchange (`.RO`)**: Full support for Romanian equities and ETFs (e.g., `TLV.RO`, `SNP.RO`, `H2O.RO`, `SNG.RO`, `TVBETETF.RO`).
- **International Exchanges**: Support for US (`.US` / NYSE / NASDAQ), German (`.DE` / XETRA), UK (`.UK` / LSE), Dutch (`.NL`), and French (`.FR`) securities.
- **Fidelis Government Bonds (`Titluri de Stat Fidelis`)**:
  - Automatic detection of BVB Fidelis tickers (e.g., `R2612A.RO`, `R2704AE.RO`).
  - Live scraping of bond metadata (issue date, maturity date, annual coupon rate, nominal value `100 RON` or `100 EUR`, tax-exempt status) from BVB.
  - **Dirty vs. Clean Price Valuation**: Automatically calculates daily accrued interest (*dobânda la zi*) and adds it to the BVB clean price for accurate mark-to-market valuation.
  - **Automated Coupon Sync**: Automatically generates and records historical annual coupon payments into the dividend ledger based on purchase date and bond schedule.

### 3. FIFO Accounting & Romanian Fiscal Engine (2026 Rules)
- **Lot-by-Lot FIFO Engine**: Matches `SELL` orders against historical `BUY` lots using First-In, First-Out accounting, factoring in broker commissions and historical transaction-date FX rates.
- **Holding Period Classification**: Automatically separates realized gains into short-term (`< 365 days`) and long-term (`>= 365 days`) buckets per lot.
- **Three Fiscal Regimes**:
  - **Resident Broker (Romania)**: `3%` tax on gains held `>= 365 days` and `6%` on gains held `< 365 days` (withheld at source; losses do not offset across transactions).
  - **Foreign Broker (Self-Declared / Declarația Unică)**: `16%` flat tax on annual net capital gains (losses offset gains within the same fiscal jurisdiction).
  - **Tax-Exempt (`0%`)**: Automatic `0%` capital gains and `0%` coupon tax treatment for Romanian Fidelis Government Bonds.
- **CASS (Health Insurance) Threshold Tracker**:
  - Real-time monitoring of combined annual non-salary investment income (taxable capital gains + net dividends) against the **6, 12, and 24 gross minimum wage** thresholds (`Salariul Minim Brut` configurable per fiscal year, defaulting to `4,050 RON`).
  - Visual progress bars, remaining buffer alerts, and exact `10%` CASS liability projections (`2,430 RON` / `4,860 RON` / `9,720 RON`).

### 4. Performance, Risk & Income Dashboards
- **Portfolio Growth Chart**: Interactive historical time-series comparing **Total Portfolio Value** against **Cumulative Invested Capital** across customizable timeframes (`1M`, `3M`, `6M`, `YTD`, `1Y`, `ALL`).
- **Monthly Return Heatmap**: Calendar matrix of monthly percentage and absolute returns with year-to-date summaries.
- **Allocation & Exposure Breakdowns**: Interactive visualizations for Asset Class (Equities vs. Fidelis Bonds vs. Cash), Sector weights, Currency exposure, and Top Gainers/Losers.
- **Dividend & Coupon Ledger**: Track gross/net cash distributions, withholding taxes, Yield-on-Cost (YoC), monthly seasonal income distribution, and automatic Fidelis coupon entries.

### 5. Market Intelligence & Portfolio Diagnostics
- **Single-Stock Technical & Fundamental Intelligence**:
  - Computes 1-year quantitative indicators: **SMA-50**, **SMA-200** (Golden/Death Cross detection), **RSI-14**, **MACD (12, 26, 9)**, **52-Week High/Low range**, annualized volatility, and max drawdown.
  - Synthesizes live company news, earnings catalysts, valuation multiples, and risk factors using server-side search grounding.
- **Institutional Portfolio Diagnostics**:
  - Computes portfolio-level **Beta**, **Sharpe Ratio**, **Sortino Ratio**, **Historical Value-at-Risk (VaR 95%)**, **Herfindahl-Hirschman Index (HHI)** concentration score, and pairwise **Asset Correlation Matrix**.
  - Generates executive portfolio rebalancing and risk-mitigation recommendations.

### 6. Data Portability, Administration & Security
- **CSV Import & Export**: Bulk import and export transactions and dividend ledgers via standardized CSV templates.
- **Role-Based Access Control (RBAC)**: Multi-user workspace isolation enforced via Firestore Security Rules (`owner`, `admin`, `user` roles) with an Admin Panel for user approval and global ticker metadata management.
- **Hardened Express Backend**: Built-in rate limiting, strict security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`), input sanitization, and bounded LRU/TTL memory caches.

---

## Local Development & Production Build

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the full-stack development server (port 3000):**
   ```bash
   npm run dev
   ```
   This starts the Express server (`server.ts`) with Vite middleware mounted for hot reloading.

3. **Type-check the codebase:**
   ```bash
   npm run lint
   ```

4. **Build for production:**
   ```bash
   npm run build
   ```
   Compiles the React frontend into `dist/` via Vite and bundles the Express server into `dist/server.cjs` via esbuild.

5. **Run the production server:**
   ```bash
   npm start
   ```

---

## Disclaimer

This application is intended for personal portfolio management and informational purposes only. Market data may be delayed, and financial metrics or Romanian tax/CASS calculations are estimates that do not constitute financial, tax, or legal advice.
