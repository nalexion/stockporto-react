# StockPortfolioTracker

A multi-currency investment portfolio tracker and fiscal analytics dashboard tailored for **Bucharest Stock Exchange (BVB)** and **international equity investors** in Romania.

**Live Application:** [https://nalexion.github.io/stockporto-react/](https://nalexion.github.io/stockporto-react/)

---

## Overview

**StockPortfolioTracker** provides real-time portfolio valuation, FIFO cost-basis accounting, dividend tracking, historical performance charts, and automated **2026 Romanian tax and CASS (Health Insurance) threshold calculations** across multiple portfolios and currencies (`RON`, `EUR`, `USD`).

---

## Key Features

### 1. Multi-Portfolio & Multi-Currency Valuation
- **Unified Global Bar:** Aggregate net worth across all portfolios in real time with instant switching between `RON`, `EUR`, and `USD`.
- **Live FX Rates:** Automatic currency conversion powered by National Bank of Romania (BNR) and European Central Bank (ECB / Frankfurter) exchange rates, including historical FX rate matching for past transactions.
- **Cash & Margin Support:** Track uninvested cash balances or negative margin balances alongside equity and bond holdings.

### 2. BVB (`.RO`), International Equities & Fidelis Government Bonds
- **Global & Local Market Data:** Supports Bucharest Stock Exchange tickers (`TLV.RO`, `SNP.RO`, `H2O.RO`, `SNG.RO`, `TVBETETF.RO`, `PTENGETF.RO`, etc.) as well as international exchanges (`.US`, `.DE`, `.UK`, `.NL`, `.FR`).
- **Romanian Fidelis Sovereign Bonds (`Titluri de Stat Fidelis`):** Native recognition for BVB Fidelis bond tickers (`R<YY><MM><Tranche>`, e.g., `R2608A`, `R2704A`, `R2805AE`), automatic `100.00 RON` / `100.00 EUR` nominal par valuation, BVB market scraping with par fallback, and 100% tax-exempt classification under the Romanian Fiscal Code.

### 3. 2026 Romanian Tax & CASS Compliance Engine
- **Capital Gains Tax regimes (Law 239/2025):**
  - **Resident Broker (`ro_resident`):** 3% withholding tax for lots held $\ge 365$ days and 6% for lots held $< 365$ days (losses non-deductible).
  - **Foreign Broker (`foreign`):** 16% self-assessed tax via *Declarația Unică (Form 212)* with annual net loss offsetting.
  - **Tax-Exempt (`tax_exempt`):** 0% capital gains and 0% dividend tax (e.g., Fidelis Government Bonds).
- **Global CASS (Health Insurance) Tracker:**
  - Automatically aggregates annual non-salary investment income (realized capital gains + net dividends) in `RON` against the 2026 gross minimum wage (**4,050 RON**):
    - **Tier 1 (6x Minimum Wage = 24,300 RON):** 2,430 RON CASS due (10%)
    - **Tier 2 (12x Minimum Wage = 48,600 RON):** 4,860 RON CASS due (10%)
    - **Tier 3 (24x Minimum Wage = 97,200 RON):** 9,720 RON CASS due (10% cap)

### 4. Comprehensive Portfolio Analytics & Reporting
- **Overview Tab:** Holdings table with FIFO average cost, current price, unrealized P&L, portfolio weight, and interactive Cost Basis vs. Market Value charts.
- **Growth Tab:** Historical portfolio value vs. cumulative invested capital across customizable timeframes (`1M`, `3M`, `6M`, `YTD`, `1Y`, `ALL`) plus monthly return heatmaps.
- **Dividends Tab:** Full dividend ledger (Gross, Withholding Tax, Net), yield-on-cost metrics, and monthly/annual dividend income projections.
- **Allocation Tab:** Interactive sector, industry, currency, and asset-class breakdowns.
- **Realized Gains Tab:** FIFO lot-by-lot realized P&L breakdown, holding-period classification ($\ge 365$ days vs. $< 365$ days), and downloadable **ANAF Declarația Unică (Form 212) CSV Export**.
- **Advisor Tab:** On-demand fundamental and portfolio diversification analysis powered by Gemini.
- **CSV Import / Export:** Bulk import and export transactions (`BUY`, `SELL`, `DIVIDEND`) and cash ledger entries.

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 6, Tailwind CSS 4, Recharts, Lucide Icons
- **Authentication & Database:** Firebase Authentication (Email/Password & Google Sign-In) + Cloud Firestore (with strict per-user ownership rules)
- **Backend / API Layer:** Node.js & Express (`server.ts`), `yahoo-finance2` for market quotes and historical charts, BNR XML & Frankfurter FX feeds, and `@google/genai` for portfolio insights
- **CI/CD:** GitHub Actions workflow (`.github/workflows/deploy.yml`) for automated static deployment to GitHub Pages

---

## Getting Started

### Prerequisites
- **Node.js** 20+ and **npm**
- A **Firebase project** with Firestore and Authentication enabled

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/nalexion/stockporto-react.git
   cd stockporto-react
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Copy `.env.example` to `.env` and set your environment variables if running the full-stack advisor backend locally:
   ```bash
   cp .env.example .env
   ```

4. **Start the development server (Port 3000):**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000/stockporto-react/` in your browser.

---

## Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the Express + Vite development server on port `3000` |
| `npm run build` | Builds the production frontend (`dist/`) and bundles `server.ts` (`dist/server.cjs`) |
| `npm start` | Runs the compiled production Express server (`node dist/server.cjs`) |
| `npm run lint` | Runs TypeScript type-checking (`tsc --noEmit`) |

---

## Project Structure

```text
├── .github/workflows/
│   └── deploy.yml             # GitHub Actions workflow for GitHub Pages deployment
├── src/
│   ├── components/
│   │   ├── GlobalValuationBar.tsx  # Multi-currency global net worth & BNR FX bar
│   │   ├── GlobalCassTracker.tsx   # 2026 Romanian CASS threshold progress tracker
│   │   ├── PortfolioList.tsx       # Portfolio cards, creation, and summary metrics
│   │   ├── PortfolioView.tsx       # Tabbed analytics (Overview, Growth, Dividends, Tax, Advisor)
│   │   ├── TransactionForm.tsx     # Buy / Sell / Dividend entry modal with live FX lookup
│   │   └── Login.tsx               # Firebase Email/Password & Google authentication
│   ├── lib/
│   │   ├── api.ts                  # Firestore CRUD, FIFO accounting, and market/FX API client
│   │   ├── bvbStaticMap.ts         # Curated BVB (.RO) & Fidelis bond metadata registry
│   │   └── firebase.ts             # Firebase SDK initialization
│   ├── App.tsx                     # Root application layout and portfolio state
│   └── main.tsx                    # Application entry point & error boundary
├── server.ts                       # Express API server (Yahoo Finance, BNR FX, Gemini Advisor)
├── firestore.rules                 # Firestore security rules
└── vite.config.ts                  # Vite configuration (with /stockporto-react/ base path)
```

---

## License

This project is provided for personal portfolio tracking and educational purposes. Tax and CASS calculations are estimates based on 2026 Romanian fiscal rules and do not constitute formal fiscal or legal advice.
