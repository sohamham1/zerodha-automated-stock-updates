# zerodha-automated-stock-updates

`zerodha-automated-stock-updates` is a GitHub-first CLI that pulls your real Zerodha equity holdings through Kite MCP, gathers public stock evidence for Indian stocks, and generates a weekly portfolio update pack in `Excel + Markdown`, with optional `PDF`.

This is not a web app and not a trading bot. It is a local-first portfolio intelligence workflow.

## What it does

For each stock in a Zerodha portfolio, the project can generate:

- original average buy price
- current market price
- all-time P&L and return
- portfolio weight
- weekly market move context
- **technical indicators**: 50-day Simple Moving Average (SMA), 14-day Relative Strength Index (RSI), and price volatility index
- **account margins**: equity and commodity available cash limits
- **recent transactions**: weekly orders audit log
- recent news and corporate developments
- dividends, corporate actions, and public company updates
- promoter/shareholding and investor-oriented signals where available
- brokerage-consensus style summaries, with transparent coverage notes
- AI-written sentiment with reasons, watchpoints, and missing-evidence notes

The output is designed for people who want to know what their portfolio is doing and why.

## Product modes

This repo supports two modes.

### Mode A: Manual ChatGPT / Codex mode

Use this when you do not want an API key yet.

Flow:

1. Fetch Zerodha holdings locally
2. Prepare a grounded packet
3. Paste that packet into ChatGPT or Codex manually
4. Get the final summary from your chat interface

This is the easiest personal-use path.

### Mode B: Automated BYO API mode

Use this when you want the real reusable product flow.

Flow:

1. Connect Zerodha through Kite MCP
2. Choose your AI provider
3. Add your own API key locally
4. Run one command
5. Get the full weekly report pack automatically

Supported providers:

- OpenAI
- Claude
- Gemini

## Who this is for

- Zerodha users with Indian equity portfolios
- investors who want weekly stock updates grounded in real holdings data
- builders who want a real-world AI automation project for GitHub

## Project scope

`v1` is intentionally narrow:

- Indian stocks only
- Zerodha holdings only
- read-only portfolio workflow
- weekly snapshot reporting, not intraday monitoring

## What the report contains

### Portfolio-level view

- total current portfolio value
- total invested value
- all-time P&L
- all-time return
- **available cash margins** (equity and commodity segments)
- **weekly transaction audit count**
- executive summary
- immediate action points
- portfolio weight snapshot

### Per-stock view

- quantity held
- average buy price
- current price
- current value
- all-time P&L and return
- weekly move
- **50-day SMA, 14-day RSI, and Volatility %**
- brokerage-consensus line where public coverage exists
- what happened
- why it may be moving
- watchpoints
- missing-evidence caveats
- source links

### Account & Transactions view (Excel Only)

- detailed equity & commodity cash margins limits
- recent orders audit list (timestamp, symbol, quantity, price, status, and message)

## Quick start

### What you need

- Node.js 20+
- Python 3
- Zerodha account

For automated mode only:

- your own OpenAI, Claude, or Gemini API key

### Beginner-friendly Windows path

You can use the included launcher:

```bat
start.bat
```

That gives a simple menu for:

- setup
- fetch holdings
- prepare manual ChatGPT packet
- generate full report

### CLI path

Guided setup (defaults to `.env`, or `.env.<profile>` if `--profile` is specified):

```bash
node ./src/cli.js setup [--profile name]
```

Fetch holdings:

```bash
node ./src/cli.js portfolio fetch [--profile name]
```

Prepare manual ChatGPT packet:

```bash
node ./src/cli.js report prepare-for-chatgpt [--profile name]
```

Generate the full weekly report:

```bash
node ./src/cli.js report generate --period weekly [--include-pdf] [--profile name]
```

Register automated report scheduling in Windows Task Scheduler:

```bash
node ./src/cli.js schedule register [--frequency weekly|biweekly|monthly] [--profile name]
```

*When a scheduled task runs, it will trigger a Windows system notification displaying the absolute path to the generated Excel file.*

## Output files

Generated outputs are written under `artifacts/` (or `artifacts/<profile>/` if using profiles).

Typical outputs:
- `report_<date>_<profile>.xlsx` (Highly formatted Excel workbook containing Portfolio Dashboard, Heatmap, Holdings Detail, Stock Narrative Summaries, and Zerodha Accounts/Recent Transactions History)
- `report_<date>_<profile>.pdf` (Visual report PDF brief)
- `report.json`
- `report.md`



## Why Kite MCP

By default, this project uses the hosted Kite MCP bridge:

```bash
npx mcp-remote https://mcp.kite.trade/mcp
```

That keeps onboarding simpler for most users. They do not need to create a separate Kite Connect developer app just to fetch their own holdings.

## API key and billing model

This repo is bring-your-own-AI.

- users use their own OpenAI / Claude / Gemini key
- keys stay on their own machine
- this repo does not share credits, plans, or tokens

Important:

- `ChatGPT Plus` is not the same as OpenAI API billing
- a user can use ChatGPT manually in `Mode A` without an API key
- a user needs a separate paid API account for `Mode B`

## Estimated API cost

These are rough weekly estimates for the stock-summary stage only, assuming about `4,000 input tokens + 500 output tokens per stock`.

As of `May 30, 2026`, the repo positioning uses:

- `OpenAI GPT-4.1 mini` as the default recommendation
- `Gemini 2.0 Flash` as the budget option

Approximate weekly cost:

| Portfolio size | GPT-4.1 mini | Claude 3.5 Haiku | Gemini 2.0 Flash |
| --- | ---: | ---: | ---: |
| 10 stocks | ~$0.03 | ~$0.06 | ~$0.007 |
| 25 stocks | ~$0.08 | ~$0.16 | ~$0.02 |
| 50 stocks | ~$0.16 | ~$0.32 | ~$0.04 |

These are only ballpark estimates. Real cost depends on evidence volume and summary length.

## Privacy

- portfolio data is processed locally
- `.env` stays local
- cached snapshots stay local
- generated reports stay local
- if automated AI mode is used, summarization payloads go to the chosen provider under the user's own account

## Current source coverage

`v2` currently includes:

- Zerodha holdings, positions, **margins**, and **orders** through Kite MCP
- **historical price candles** (daily interval) for trend metrics (SMA, RSI, Volatility)
- public news evidence collection
- AI summarization through OpenAI, Claude, or Gemini
- **multi-profile configurations** (isolated `.env.<profile>`, `.cache/`, and `artifacts/`)
- **automated scheduled tasks** and desktop notification alerts

The enrichment layer is designed to expand later with more official exchange and company-source adapters.

## Limitations

- some Indian stocks have sparse public broker coverage
- brokerage-consensus lines can be partial for thinly covered names
- news quality varies by stock
- `v1` does not yet parse every official NSE/BSE filing feed directly
- this project is not financial advice

## Repo structure

```text
src/      CLI, Kite integration, enrichment, summarization, report generation
tools/    export helpers for polished Excel and PDF artifacts
tests/    basic unit tests
```

## Recommended public GitHub positioning

If you use this repo publicly, describe it as:

`A local-first CLI that turns Zerodha holdings into weekly AI portfolio updates with Excel/PDF outputs and transparent source grounding.`

## License

MIT
