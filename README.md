# StockPortfolioTracker

A multi-currency investment portfolio tracker and fiscal analytics dashboard designed for **Bucharest Stock Exchange (BVB)** and **international equity investors**.

---

## Overview

**StockPortfolioTracker** is a web application for managing multi-currency investment portfolios (`RON`, `EUR`, `USD`). It combines real-time market valuation, FIFO cost-basis accounting, dividend tracking, historical performance visualization, and automated Romanian tax and CASS (Health Insurance) threshold tracking in a single workspace.

---

## Core Capabilities

- **Multi-Portfolio & Multi-Currency Valuation**
  Aggregate net worth across multiple portfolios with instant switching between `RON`, `EUR`, and `USD`, backed by automatic central bank exchange rates and cash/margin balance tracking.

- **Local & International Asset Coverage**
  Supports Bucharest Stock Exchange (`.RO`) equities, ETFs, and **Fidelis Government Bonds (`Titluri de Stat Fidelis`)**, alongside major international exchanges (`.US`, `.DE`, `.UK`, `.NL`, `.FR`).

- **FIFO Accounting & Tax Reporting**
  Automated lot-by-lot FIFO cost basis calculation, holding-period classification, realized P&L reporting, and annual CASS threshold tracking tailored to Romanian fiscal rules (resident broker, foreign broker, and tax-exempt regimes).

- **Performance & Income Analytics**
  Interactive dashboards for portfolio growth vs. invested capital, monthly return heatmaps, dividend ledgers with yield-on-cost metrics, sector/currency allocation breakdowns, and CSV import/export.

---

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Recharts
- **Backend & Data:** Node.js, Express, Firebase Authentication & Cloud Firestore
- **Market & FX Data:** Yahoo Finance, BNR, and ECB exchange rate feeds

---

## Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env` and provide the required configuration values.

3. **Run the development server:**
   ```bash
   npm run dev
   ```

4. **Build for production:**
   ```bash
   npm run build
   ```

---

## Disclaimer

This project is intended for personal portfolio management and informational purposes only. Financial metrics and tax calculations are estimates and do not constitute financial, tax, or legal advice.
