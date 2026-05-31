# V2 Implementation Plan - Portfolio Intelligence Enhancements

This plan outlines the updates to `zerodha-automated-stock-updates` to implement advanced portfolio intelligence features and workflow usability enhancements.

---

## Proposed Changes

### Component 1: Kite Client & Data Ingestion (`src/lib/kite/` & `src/lib/pipeline/`)

#### [MODIFY] [kite-client.js](file:///c:/Users/Asus/Documents/stocks-info-tracker/src/lib/kite/kite-client.js)
* Implement `fetchMargins()` to call the `get_margins` tool from the Kite MCP.
* Implement `fetchHistoricalData(instrumentToken, interval, fromDate, toDate)` to call the `get_historical_data` tool.
* Implement `fetchRecentOrders()` to call `get_orders` or `get_order_history` to pull recent transactions.

#### [MODIFY] [fetch-portfolio.js](file:///c:/Users/Asus/Documents/stocks-info-tracker/src/lib/pipeline/fetch-portfolio.js)
* Call `fetchMargins()` and save available cash margins in the snapshot payload under a `margins` field.
* Iterate over portfolio holdings and fetch 90 days of daily historical candles using `fetchHistoricalData()`.
* Calculate technical and trend indicators:
  - 50-day Simple Moving Average (SMA).
  - Relative Strength Index (RSI).
  - Price volatility (standard deviation of daily returns).
* Query recent orders via `fetchRecentOrders()` and merge them into the daily snapshot payload.

---

### Component 2: Multi-Profile & Config Configuration (`src/lib/` & `src/cli.js`)

#### [MODIFY] [config.js](file:///c:/Users/Asus/Documents/stocks-info-tracker/src/lib/config.js)
* Update `loadConfig` to accept a `--profile <name>` flag.
* If a profile is specified (e.g., `dad`), load environment variables from `.env.dad` (falling back to `.env`).
* Namespace path resolutions:
  - Cache directory: `.cache/<profile>/`
  - Output directory: `artifacts/<profile>/`

#### [MODIFY] [cli.js](file:///c:/Users/Asus/Documents/stocks-info-tracker/src/cli.js)
* Update the CLI parameter parser to recognize the `--profile` flag and pass it down to `loadConfig`.

---

### Component 3: CLI Progress Experience (`src/lib/utils.js`)

#### [MODIFY] [utils.js](file:///c:/Users/Asus/Documents/stocks-info-tracker/src/lib/utils.js)
* Add a simple custom console spinner/progress tracker to display current pipeline steps (e.g., `▸ Fetching news for RELIANCE... [1/15]`) without adding large external dependency footprints.

---

### Component 4: Export Engine Styling & Calculations (`tools/` & `src/lib/report/`)

#### [MODIFY] [export_report.py](file:///c:/Users/Asus/Documents/stocks-info-tracker/tools/export_report.py)
* Read the newly included margins, trends, and transaction history from the `report.json` payload.
* **Dashboard Tab Enhancements**:
  - Add a dedicated "Available Capital & Margins" KPI card.
  - Render a summary table for weekly trades and transactions.
* **Holdings Detail & Stock Summaries**:
  - Include columns for technical trend indicators (50-day SMA position, RSI, volatility metrics).
  - Apply custom spreadsheet formatting (borders, green-to-red heatmaps for returns, auto-fitting column dimensions).

### Component 5: Automation & Scheduling

#### [NEW] [schedule_task.js](file:///c:/Users/Asus/Documents/stocks-info-tracker/src/lib/schedule/schedule-task.js)
* Create a lightweight utility to automate scheduled reporting:
  - Generate a Windows Task Scheduler task using the system `schtasks` command.
  - Support choosing the frequency (`weekly`, `biweekly`, `monthly`) via CLI flags (e.g., `--frequency weekly`).
  - Trigger a system desktop notification when a task run completes. The notification will display the absolute path of the generated report using a PowerShell toast/balloon notification snippet.
* Register a new command in the CLI: `node ./src/cli.js schedule register [--frequency weekly|biweekly|monthly]`.

#### [MODIFY] Report Export Naming Conventions
* Update report exporters so generated files include the current date (ISO format `YYYY-MM-DD`) and the active profile name.
  - Example output name: `report_2026-05-31_default.xlsx` (or `report_2026-05-31_dad.xlsx`).

---

## Verification Plan

### Automated Tests
- Run the existing tests suite:
  ```powershell
  npm test
  ```
- Write mock test cases for `get_margins`, `get_historical_data`, and multi-profile config loading in `tests/config.test.js`.

### Manual Verification
- Execute `node ./src/cli.js setup` and configure a test profile.
- Fetch holdings and generate a mock weekly report verifying margins and transactions appear on the dashboard.
- Open the newly generated styled Excel file `weekly_report.xlsx` and verify layout, alignment, and coloring.
