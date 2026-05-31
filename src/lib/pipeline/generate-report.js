import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fetchPortfolioSnapshot } from "./fetch-portfolio.js";
import { GoogleNewsRssProvider } from "../providers/google-news-rss.js";
import { BrokerageConsensusProvider } from "../providers/brokerage-consensus.js";
import { OpenAiSummarizer } from "../summarizers/openai.js";
import { AnthropicSummarizer } from "../summarizers/anthropic.js";
import { GeminiSummarizer } from "../summarizers/gemini.js";
import { HeuristicSummarizer } from "../summarizers/heuristic.js";
import { exportReportArtifacts } from "../report/exporters.js";
import { buildWeeklyActivitySummary } from "../portfolio/weekly-activity.js";
import { weekKey, writeJson, ProgressLogger } from "../utils.js";
import { triggerSystemNotification } from "../schedule/schedule-task.js";

function chooseSummarizer(config) {
  if (config.llm?.provider === "openai" && config.llm?.active?.apiKey) {
    return new OpenAiSummarizer(config);
  }
  if (config.llm?.provider === "anthropic" && config.llm?.active?.apiKey) {
    return new AnthropicSummarizer(config);
  }
  if (config.llm?.provider === "gemini" && config.llm?.active?.apiKey) {
    return new GeminiSummarizer(config);
  }
  return new HeuristicSummarizer();
}

function buildPortfolioSummary(holdings) {
  const sentimentCounts = {
    bullish: 0,
    neutral: 0,
    cautious: 0,
    unclear: 0,
  };

  for (const holding of holdings) {
    const sentiment = holding.summary?.sentiment || "unclear";
    if (!(sentiment in sentimentCounts)) {
      sentimentCounts.unclear += 1;
      continue;
    }
    sentimentCounts[sentiment] += 1;
  }

  return {
    holdingsCount: holdings.length,
    totalValue: holdings.reduce((sum, item) => sum + item.currentValue, 0),
    totalPnl: holdings.reduce((sum, item) => sum + item.pnl, 0),
    sentimentCounts,
  };
}

export async function generateWeeklyReport({ config, period, includePdf }) {
  console.log(`Starting Weekly Report Generation [Profile: ${config.profile || "default"}]`);
  
  const totalSteps = 4 + 1; // fetch holdings + choosing summarizer + loop stocks + saving files
  const logger = new ProgressLogger(totalSteps);

  logger.next("Fetching Zerodha portfolio snapshot and margins...");
  const snapshot = await fetchPortfolioSnapshot({ config });

  logger.next("Initializing providers and choosing summarizer...");
  const provider = new GoogleNewsRssProvider(config);
  const brokerageProvider = new BrokerageConsensusProvider(config);
  const summarizer = chooseSummarizer(config);
  const outputDir = path.join(config.paths.outputDir, weekKey());
  const weeklyActivityMap = await buildWeeklyActivitySummary(
    config,
    snapshot.holdings,
    snapshot.trades || []
  );

  await mkdir(outputDir, { recursive: true });

  logger.next(`Enriching and summarizing portfolio holdings (total: ${snapshot.holdings.length})...`);
  const holdings = [];
  let count = 0;
  for (const holding of snapshot.holdings) {
    count++;
    logger.info(`[${count}/${snapshot.holdings.length}] Processing ${holding.symbol} (${holding.companyName})...`);
    const evidence = await provider.fetchForHolding(holding);
    const brokerageConsensus = await brokerageProvider.fetchForHolding(holding);
    const summary = await summarizer.summarize(holding, evidence);

    const weeklyActivity =
      weeklyActivityMap.get(`${holding.exchange}:${holding.symbol}`) || null;
    const nextHolding = {
      ...holding,
      evidence,
      brokerageConsensus,
      weeklyActivity,
      summary,
    };

    holdings.push(nextHolding);

    const evidencePath = path.join(
      config.paths.cacheDir,
      "evidence",
      weekKey(),
      `${holding.exchange}-${holding.symbol}.json`
    );
    await writeJson(evidencePath, {
      holding: {
        symbol: holding.symbol,
        exchange: holding.exchange,
        companyName: holding.companyName,
      },
      evidence,
      brokerageConsensus,
      weeklyActivity,
      summary,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    period,
    profile: config.profile || "default",
    summary: {
      ...buildPortfolioSummary(holdings),
      margins: snapshot.margins || {},
      ordersCount: (snapshot.orders || []).length,
    },
    holdings,
    positions: snapshot.positions || { net: [], day: [] },
    trades: snapshot.trades || [],
    orders: snapshot.orders || [],
    margins: snapshot.margins || {},
  };

  logger.next("Compiling report payload and exporting Excel/PDF artifacts...");
  await exportReportArtifacts({
    config,
    report,
    outputDir,
    includePdf: includePdf || config.report.includePdf,
  });

  logger.success(`Successfully generated report files in: ${outputDir}`);

  if (config.notify) {
    const profile = config.profile || "default";
    const dateStr = report.generatedAt.slice(0, 10);
    const excelFile = path.resolve(outputDir, `report_${dateStr}_${profile}.xlsx`);
    triggerSystemNotification(
      "Stock Update Generated",
      `Your portfolio brief is generated successfully!\n\nPath: ${excelFile}`
    );
  }

  return {
    outputDir,
    report,
  };
}
