# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.3] - 2026-10-24

### Cleaned & Documented
- **Workspace Root Cleanup & Diagnostic Reference Preservation (`v2.3.3`)**:
  - Removed 76 obsolete one-off migration, patch, and diagnostic scratch files (`fix_*.cjs`, `patch_*.cjs`, `test*.js/cjs/ts`, `sim*.ts`, `debug_chart.cjs`, `run_diagnostics.cjs`, `get_old_chart.js`, `response.json`) from the project root directory.
  - Preserved all useful symbol mappings and diagnostic patterns directly in the codebase and changelog:
    - **Exchange Suffix Remapping (`server.ts` & `src/lib/api.ts`)**: `.NL` tickers automatically normalize to `.AS` (Euronext Amsterdam) for Yahoo Finance queries and map back to `.NL` for UI consistency; `.US` suffixes are stripped before querying Yahoo Finance and remapped to `.US` lots.
    - **BVB & European ETF Sector Profiles (`server.ts`)**: Added `PTENGETF.RO` (`ETFs & Funds` / `Energy Sector ETFs`) alongside `TVBETETF.RO` and the BVB blue-chip profile dictionary (`TLV.RO`, `SNP.RO`, `H2O.RO`, `SNG.RO`, `SNN.RO`, `DIGI.RO`, `LION.RO`, etc.).

## [2.3.2] - 2026-10-17

### Security
- **Application Security & Vulnerability Management Hardening (`v2.3.2`)**:
  - **`VULN-01` — Zero-Trust Firestore Security Rules (`firestore.rules` & `firebase-blueprint.json`)**: Added a global default-deny catch-all rule, separated `read`/`create`/`update`/`delete` permissions, enforced immutable ownership (`request.resource.data.userId == resource.data.userId`) and `portfolioId` immutability on `update`, and validated schema types, enum values, string lengths, and non-negative numeric bounds.
  - **`VULN-02` — Bounded In-Memory Caches & Symbol Validation (`server.ts`)**: Enforced strict symbol allowlist validation (`/^[A-Z0-9.^=-]{1,24}$/i`), capped batch ticker requests (`MAX_TICKERS_PER_REQUEST = 50`), and added bounded FIFO eviction (`MAX_CACHE_ENTRIES = 500`, `MAX_TRACKED_SYMBOLS = 250`) across `yfCache`, `historicalCache`, and `trackedTickers` to prevent memory exhaustion.
  - **`VULN-03` — LLM Advisor Prompt Injection & Rate Limiting (`server.ts`)**: Added per-IP sliding-window rate limiting (`15 req/min`), capped `holdings` payload length (`MAX_ADVISOR_HOLDINGS = 25`), and sanitized `ticker`, `companyName`, and `currency` inputs before constructing Gemini prompts.
  - **`VULN-04` — CSV Formula Injection Defense (`CWE-1236`)**: Neutralized leading spreadsheet formula characters (`=`, `+`, `-`, `@`, `\t`, `\r`) during CSV exports in `PortfolioView.tsx` and `GlobalCassTracker.tsx` and sanitized imported CSV cells in `CSVImportModal.tsx`.
  - **`VULN-05`, `VULN-06` & `VULN-07` — Express Hardening & Dead Route Removal (`server.ts`)**: Tightened `express.json` body limit from `10mb` to `256kb`, disabled `x-powered-by`, added `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Permissions-Policy` headers, and removed the dangling `/api/lots` endpoint.

## [2.3.1] - 2026-10-17

### Fixed & Improved
- **Core Financial Math, Performance & Engineering Hardening (`v2.3.1`)**:
  - **Stock Split (`SPLIT`) Handling in `portfolioMath.ts`**: Separated `SPLIT` from `SELL` in `buildPortfolioGroups` so stock splits properly multiply `qty` and open lot `remaining` shares by the split ratio and divide per-share `cost` and `buyCommPerShare` by the ratio instead of deducting shares.
  - **Deterministic Same-Day Transaction Ordering (`compareLotsChronologically`)**: Added a secondary sort priority (`DEPOSIT` $\rightarrow$ `BUY` $\rightarrow$ `SPLIT` $\rightarrow$ `DIVIDEND` $\rightarrow$ `SELL` $\rightarrow$ `WITHDRAWAL`) so same-day `BUY`/`SELL` trades and same-day Fidelis Maturity `COUPON`/`SELL` redemptions always process in the correct accounting order.
  - **Weekend & Bank Holiday BNR FX Fallback (`resolveFxRateForDate`)**: Added a 7-day backward business-day lookup for historical BNR FX rates so transactions recorded on weekends or bank holidays resolve to the most recent published BNR rate instead of falling back to `1.0`.
  - **Purchase Commission Deduction in Capital Gains Tax & P&L**: Included proportional buy-side broker commissions (`buyCommPerShare`) alongside sell-side commissions when calculating realized P&L and Romanian capital gains / CASS tax liability.
  - **Firestore & BNR Request Deduplication (`src/lib/api.ts`)**: Added short-TTL in-flight request deduplication (`invalidateDataCache` on mutations) for `fetchPortfolios`, `fetchAllLots`, and `fetchBnrRates`, plus parallelized `Promise.all` quote fetching across portfolios in `PortfolioList` and `GlobalValuationBar`.
  - **Cryptographic IDs & Full-Fidelity CSV Export/Import**: Upgraded ID generation to `crypto.randomUUID()`, added RFC-4180 quote escaping and Fidelis bond metadata columns to `handleExportCSV`, supported both Yahoo Finance and native CSV formats in `CSVImportModal`, and removed unused legacy in-memory CRUD routes from `server.ts`.

## [2.3.0] - 2026-10-17

### Added
- **Subscription vs. Secondary Market (`Buy`) Coupon Calculation Logic (`v2.3.0`)**:
  - **Added `Subscription` to Transaction Type Dropdown (`TransactionModal.tsx`)**: Kept the clean, familiar transaction modal layout while adding **`Subscription`** alongside **`Buy`** in the **Transaction Type** selector.
  - **Option A — `Subscription` (Primary Market)**: Fixes `cleanPrice = 100.00`, `accruedInterest = 0.00`, and `buyPrice = 100.00`, and calculates Year 1 and all subsequent annual coupons at the full annual coupon rate (`units * 100 * coupon_rate`, `0.00` advance deduction).
  - **Option B — `Buy` (Secondary Market / BVB)**: Automatically applies `T+2` business-day settlement and **Actual/365** accrued interest in the background (`accrued_interest_per_unit = 100 * coupon_rate * (days_elapsed / 365)`), splitting the Year 1 coupon into **Bucket 1 (Advance Reimbursement: `repaid_advance = total_interest_advanced`)** and **Bucket 2 (True Net Profit: `net_profit_year_1 = gross_cash_received - total_interest_advanced`)**, while Years 2 through Maturity receive the full annual coupon.

## [2.2.3] - 2026-10-17

### Added
- **Editable Net Coupon & Seller Accrued Interest Adjustment (`v2.2.3`)**:
  - **Inline Coupon Amount Editor in Buy/Edit Modal (`TransactionModal.tsx`)**: When adding or editing a Fidelis `BUY` transaction (or editing a `COUPON` row directly), past annual coupons now display an inline editable amount box (`Amount (RON/EUR)`) alongside 1-click **`Use Net (-Accrued)`** and **`Use Full`** buttons so you can set the exact net coupon earned after deducting the accrued interest paid to the seller (e.g., `890.50 RON`).
  - **Inline Schedule Amount Editor in `Coupon / Redeem` Modal (`FidelisLifecycleModal.tsx`)**: Every coupon row in the schedule now includes an editable amount input and **`Save`** button to update already-logged coupons in 1 click, while automatically marking years prior to your purchase date as `Prior to purchase (N/A)`.

## [2.2.2] - 2026-10-17

### Fixed
- **Automatic Retroactive Fidelis Coupon Sync for Existing Portfolio Holdings (`v2.2.2`)**:
  - Added `ensureFidelisPastCoupons` in `src/lib/api.ts` (invoked automatically during `fetchLots` and `fetchAllLots`) so any existing Fidelis `BUY` holding purchased in the past (such as `R2707A` bought on `2025-05-05` with a `7%` coupon rate and `2022-07-23` start date) automatically generates and persists its past annual `COUPON` (`DIVIDEND`) payment (e.g., `2025-07-23` for `+3,500.00 RON` on `500` units) using a deterministic idempotent document ID (`coupon_<portfolioId>_<symbol>_<couponDate>`).
  - Added `inferFidelisTenorAndStartDate` in `src/config/taxRules.ts` so secondary-market Fidelis purchases made in a month prior to the bond's annual coupon month (e.g., May purchase of a July-maturing bond like `R2707A`) always infer an issue year whose July (`07`) coupon date precedes the purchase date.

## [2.2.1] - 2026-10-17

### Changed
- **10-Year (`10Y`) Fidelis Maturity Tenor & Automatic Historical Coupon Generation (`v2.2.1`)**:
  - Added **`10 Years (10Y)`** to the **Maturity Tenor** selector in both `TransactionModal.tsx` and `FidelisLifecycleModal.tsx` (`1Y`, `2Y`, `3Y`, `5Y`, `10Y`).
  - Enabled **Automatic Past Annual Coupon Generation** by default (`autoGenerateDueCoupons = true`) when recording or editing a Fidelis `BUY` transaction bought in the past, automatically aligning the issue/coupon start date and tenor with the purchase date so every elapsed annual coupon payment up to today is generated as a tax-exempt `COUPON` (`DIVIDEND`) lot.

## [2.2.0] - 2026-10-17

### Added
- **Fidelis Clean vs. Dirty Price Calculator & Automated Coupon/Maturity Engine (`v2.2.0`)**:
  - **Clean Price + ACT/ACT Accrued Interest = Dirty Price Calculator (`TransactionModal.tsx` & `taxRules.ts`)**:
    - Added dedicated **Clean Price (% of Par)**, **Accrued Interest (`Dobânda acumulată`)**, and **Dirty Price (Settlement Price)** inputs when buying or selling a Fidelis bond (`R2512A`, `R2608AE`, etc.).
    - Automatically calculates BVB ACT/ACT Accrued Interest per bond on any `Trade Date` based on the bond's **Coupon Rate (% p.a.)** and **Coupon Start Date**, while allowing manual override to match exact broker settlement slips.
    - Stores `cleanPrice`, `accruedInterest`, `dirtyPrice`, `couponRate`, `couponStartDate`, `maturityYears`, and `maturityDate` on the transaction lot and displays `Clean + Accrued` breakdowns in expanded Holdings Ledger rows.
  - **Automated Coupon Calculation from Coupon Start Date & Maturity Tenor Years (`1Y`, `2Y`, `3Y`, `5Y`)**:
    - Introducing **Coupon Start Date**, **Maturity Tenor (Years)**, and **Coupon Rate (% p.a.)** automatically computes the exact annual coupon schedule (`Year 1 .. Maturity`) and total tax-exempt coupon payment ($\text{Bond Units} \times 100 \times \text{Coupon Rate \%}$).
    - Added option on `BUY` to auto-record past due annual coupons up to today, and interactive scheduled coupon buttons when logging a `DIVIDEND` (`Bond Coupon`).
  - **1-Click Coupon Schedule & Maturity Principal Redemption Modal (`FidelisLifecycleModal.tsx` & `PortfolioView.tsx`)**:
    - Added a `Coupon / Redeem` action button directly on Fidelis rows in the Holdings Ledger.
    - Provides 1-click logging for individual or all due annual coupons and a **1-Click Maturity Redemption** action that closes open bond units at `100.00` Par (`0` commission, `0%` tax) and optionally logs the final annual coupon in one atomic step.

## [2.1.0] - 2026-10-17

### Added
- **Romanian Government Bonds (*Titluri de Stat Fidelis*) Support Within Existing Portfolios (`v2.1.0`)**:
  - **Automatic BVB Fidelis Pattern Recognition (`parseFidelisTicker` / `isFidelisBond`)**: Automatically detects BVB-listed Fidelis tickers (`R` + `YYMM` maturity + tranche code, such as `R2512A`, `R2608AE`, `R2704A.RO`) directly inside any existing portfolio alongside stocks and ETFs.
  - **Live BVB Quote Resolution & `100.00` Par Fallback (`server.ts`)**: Queries BVB for live secondary-market clean prices on Fidelis bonds and defaults to `100.00` nominal par (`100 RON` for `A/B/C` tranches, `100 EUR` for `AE/BE/CE/E` tranches) with automatic BNR/FX conversion to the portfolio's base currency.
  - **100% Tax & CASS Exemption (`Codul Fiscal Art. 93`)**:
    - Exempts Fidelis capital gains (`SELL`) and coupon interest (`DIVIDEND` / `COUPON`) from the 1% / 3% / 16% capital gains and 8% dividend tax calculations (`0.00 RON` tax liability).
    - Excludes Fidelis capital gains and coupon payments from the **Global CASS Tracker** (`6 / 12 / 24` minimum wage health insurance thresholds) and `Declaratia_Unica` taxable CSV exports.
    - Added a dedicated **Fidelis Sovereign Bonds (Tax & CASS Exempt)** summary card in the **Advanced Tax & Dividend Dashboard**.
  - **Ledger & Transaction Modal Integration**:
    - Added inline institutional metadata (`FIDELIS · EUR/RON · YYYY-MM`), `COUPON` transaction badges, and `0.00 RON (Tax-Exempt)` indicators in `PortfolioView.tsx`.
    - Added live Fidelis bond detection, `100` nominal par auto-fill, and coupon interest labeling in `TransactionModal.tsx`.
    - Classified Fidelis holdings under `Romania (BVB)`, `Bonds & Fixed Income`, and `Government Bonds (Fidelis)` in `PortfolioMarketSegments.tsx`.

---

## [2.0.0] - 2026-10-17

### Changed
- **Major Release (`v2.0.0`) — Institutional Swiss Ledger Complete (Section C: Architectural Grid, Exposed Hairline Ledger & Card Density)**:
  - **Rounded Single-Line Portfolio & KPI Figures**: Implemented whole-integer rounding (`Math.round` with `minimumFractionDigits: 0, maximumFractionDigits: 0`) and strict single-line layout (`whitespace-nowrap`) across all 5 Portfolio KPI summary boxes (`Total Invested`, `Idle Cash`, `Current Value`, `Total Net Return`, `Realized P&L`, `Est. Tax`, `TLH Savings`), Dashboard Portfolio Cards, Global Valuation Bar, and Allocation panels so large currency sums never wrap onto a second row or display trailing decimal digits. Full 2-decimal precision remains accessible via hover tooltips (`title`).
  - **Expanded Architectural Viewport (`max-w-7xl`)**: Widened the primary layout container from `max-w-6xl` (`1152px`) to `max-w-7xl` (`1280px`) across the Header, Global Valuation Telemetry Ribbon, Global CASS Compliance Tracker, Portfolio Dashboard, and Portfolio View to provide generous horizontal breathing room for 5-column KPI strips and 10-column financial tables.
  - **Exposed Hairline Bento KPI Strip**: Replaced separate floating KPI cards in `PortfolioView` with an unified 5-cell **Exposed Hairline Bento Grid** (`bg-[#E2E8F0] gap-px border border-[#E2E8F0]`) that reclaims inter-card gap width and establishes crisp `1px` architectural separation.
  - **Swiss Ledger Portfolio Cards**: Upgraded dashboard portfolio cards with hairline header/footer dividers, unboxed currency metadata, single-line rounded `Current Valuation`, and a 2-column bottom ledger (`Invested` vs `Net Return`).
  - **High-Density Holdings Ledger Table & Single-Line Action Bar**: Refined table row density (`py-3 px-4`), uppercase tracking headers (`text-[11px] uppercase tracking-wider`), vertical hairline column group dividers, Cobalt Ledger Blue (`border-l-2 border-l-[#1E40AF]`) expanded lot sub-ledgers, and compact single-line (`whitespace-nowrap shrink-0`) action buttons so toolbar controls never clip.

## [1.7.0] - 2026-10-17

### Changed
- **Institutional Swiss Ledger — Section B: Curated 60-30-10 Color Architecture (Crisp Institutional Light)**:
  - **60% Dominant Neutral Canvas (`#F8FAFC` / `#F1F5F9`)**: Established a low-glare cool alabaster ledger canvas (`#F8FAFC`) across the viewport and modal bodies, paired with `#F1F5F9` recessed tracks for segmented controls, table headers, and sub-lot drawers.
  - **30% Structural Surfaces & Typography Hierarchy (`#FFFFFF` / `#E2E8F0` / `#0F172A`)**: Standardized all cards, navigation headers, and ledger containers on pure `#FFFFFF` structural surfaces bounded by crisp `1px solid #E2E8F0` hairline dividers (eliminating muddy drop-shadow + border combinations). Transitioned the top Global Valuation Bar from a heavy dark banner into a cohesive Crisp Institutional Light telemetry ribbon. Enforced a 3-tier ink hierarchy (`#0F172A` Deep Obsidian primary figures/headings, `#334155`–`#475569` secondary prose, `#64748B` muted labels).
  - **10% High-Intent Institutional Accent & Semantic Financial Tokens**:
    - **Primary Interactive Accent — Cobalt Ledger Blue (`#1E40AF` / hover `#1E3A8A` / tint `#EFF6FF`)**: Replaced generic `indigo-600` (`#4f46e5`) across all primary CTAs, active segmented controls, focus rings, brand marks, and primary portfolio chart series.
    - **Semantic Gain / Bullish — Institutional Emerald (`#059669` / `#047857` / surface `#ECFDF5`)**: Strictly reserved for positive P&L, net return gains, dividends, and `>= 365d` long-term tax-advantaged holding ages.
    - **Semantic Loss / Tax Liability — Institutional Crimson (`#E11D48` / `#BE123C` / surface `#FFF1F2`)**: Strictly reserved for negative P&L, drawdowns, and ANAF/CASS tax obligations.
    - **Semantic Advisory / Threshold — Institutional Amber (`#D97706` / `#B45309` / surface `#FFFBEB`)**: Strictly reserved for `< 365d` short-term holding ages and active CASS threshold obligations.
    - **Curated Institutional Chart Palette**: Replaced neon rainbow chart slices with an authoritative Swiss financial palette (`#1E40AF`, `#0F172A`, `#0D9488`, `#0284C7`, `#059669`, `#475569`, `#D97706`, `#1E3A8A`, `#0891B2`, `#64748B`).

## [1.6.1] - 2026-10-17

### Fixed
- **Yahoo Finance Schema Validation & Delisted Symbol Resilience**:
  - Configured `yahoo-finance2` with `{ validateResult: false }` and silent schema validation options across `/api/historical`, `/api/quotes`, `/api/fx-historical-range`, and sector profile lookups so delisted or non-standard symbols (e.g., `FRR`) do not throw `FailedYahooValidationError` (`#/definitions/ChartResultObject`).
  - Added resilient raw chart quote extraction (`extractValidQuotes`), 1-hour caching for empty/delisted historical responses, per-symbol quote fallback if a batch quote contains an invalid ticker, and cost-basis (`buyPrice`) fallback in portfolio history calculations when historical market quotes are unavailable.

## [1.6.0] - 2026-10-17

### Changed
- **Institutional Swiss Ledger — Section A: Typographic System (The 2+1 Font Rule & Tabular Numerals)**:
  - **Display & Structural Headings (`Plus Jakarta Sans`)**: Configured crisp geometric display typography with balanced wrapping (`text-wrap: balance`) and tight tracking across the brand wordmark, portfolio titles, section headers, and modal titles.
  - **UI & Body Prose (`Public Sans`)**: Adopted high-scannability neo-grotesque body typography optimized for dense financial views and compliance disclosures.
  - **Financial Telemetry & Ledger Figures (`JetBrains Mono` + `tabular-nums`)**: Enforced strict monospace tabular figures (`font-variant-numeric: tabular-nums`) across all currency valuations, P&L percentages, BNR FX rates, share quantities, holding ages, tax liabilities, chart axes/tooltips, and numeric form inputs to eliminate horizontal layout jitter and align decimal points vertically.

## [1.5.3] - 2026-10-03

### Changed
- **Untruncated & Clear Portfolio Cards and Text**:
  - **Portfolio View KPI Cards**: Redesigned metric cards (Total Invested, Idle Cash, Current Value, Total Net Return, Realized P&L) with responsive layout (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5`), eliminating all truncation ellipsis on values, improving font hierarchy, and clearly separating Net Return monetary values and percentages.
  - **Portfolio Overview Cards**: Removed harsh header truncation, allowing full portfolio names to wrap cleanly, and enhanced each portfolio card with Current Valuation, Net Return percentage + monetary amount, and Invested Capital summary.
  - **Table & Breakdown Clarity**: Removed truncation from sublot transaction comments, allocation lists, and segment lists for clean readability across all screen widths.

## [1.5.2] - 2026-10-03

### Changed
- **Cash Precision Standard**: Strictly rounded and formatted Idle Cash, Cash holdings rows, sub-lot shares, and related cash balances across portfolios to exactly 2 decimals (`minimumFractionDigits: 2`, `maximumFractionDigits: 2`).

## [1.5.1] - 2026-10-03

### Added
- **Net Return Monetary Value Display**: Added the net return currency amount directly alongside the Net Return % in the Global Valuation Bar, dynamically converted into the selected currency (**RON**, **EUR**, or **USD**).

## [1.5.0] - 2026-10-03

### Added
- **Global Inception Metrics in Global Valuation Bar**: Added real-time performance indicators directly in line with Global Valuation:
  - **Net Return (%)**: Global portfolio net performance percentage calculated against total invested capital since inception, styled with trend indicators.
  - **Total Realized P&L**: Full FIFO realized gain/loss and dividend profit since inception across all portfolios, dynamically linked and converted to the active currency (**RON**, **EUR**, or **USD**).


### Fixed
- **AI Holding Analysis Quota & Resilience**: Upgraded model orchestration in `/api/advisor/analyze` to modern `@google/genai` models (`gemini-3.1-flash-lite` and `gemini-3.8-flash`), resolving the 429 quota exhaustion issue (`Failed to analyze TEL.RO`) by eliminating search grounding rate limits and adding multi-model failover with deterministic financial metric fallbacks.
- **Deep Sector Mappings**: Added comprehensive Romanian BVB profiles (utilities, energy, financials, industrials, technology, healthcare) and international ETF classifications, eliminating all "Other Equities" categorizations while strictly preserving operating company anonymity.

### Changed
- **Privacy & Clean Segmentation**: Streamlined the Market Segments visualization to strictly display aggregated Sector and Industry (Deep) categories without disclosing individual company tickers or holdings.

## [1.4.1] - 2026-10-03

### Added
- **Global Currency Synchronization**: Removed redundant local RON/EUR/USD selectors from the Portfolio Allocation and Market Segments cards; both now automatically synchronize in real time with the top Global Valuation Bar currency selection.
- **Deep Sector & Industry Identification**: Replaced generic "Other Equities" fallback with granular business sector and operating industry profiling via Yahoo Finance `assetProfile` data and custom market dictionaries.
- **Industry View Mode**: Added an interactive "Industry (Deep)" dimension toggle to the Market Segments visual, revealing the specific operating lines and business sectors of individual portfolio holdings.

## [1.4.0] - 2026-10-03

### Added
- **Portfolio Allocation Visual**: Replaced asset allocation with a cross-portfolio allocation chart calculating the current portfolio value and supporting currency representation in **RON / EUR / USD** with live BNR conversion rates.
- **Portfolio Market Segments**: Added a dedicated Market Segments visualization positioned next to Portfolio Allocation, with an interactive portfolio selector (including "All Portfolios" and individual portfolios) and dimension toggles for Market/Region, Asset Class, and Sector.
- Enhanced quotes endpoint with `regularMarketPrice`, `quoteType`, `market`, `exchange`, and `shortName` metadata.

### Changed
- Dashboard layout now features side-by-side Portfolio Allocation and Portfolio Market Segments cards.

### Removed
- Removed the portfolio-level **AI Diagnostics** section and modal from the portfolio view, while keeping individual holding actions ("Analyze this holding").
