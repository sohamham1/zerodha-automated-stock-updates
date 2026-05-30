import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildMarkdownReport } from "../report/markdown.js";

async function resolveSnapshotPath(config, explicitPath) {
  if (explicitPath) {
    return path.resolve(config.cwd, explicitPath);
  }

  const holdingsDir = path.join(config.paths.cacheDir, "holdings");
  const entries = await readdir(holdingsDir, { withFileTypes: true });
  const snapshots = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".daily.json"))
    .sort((a, b) => b.name.localeCompare(a.name));

  if (!snapshots.length) {
    throw new Error("No cached holdings snapshots found. Run portfolio fetch first.");
  }

  return path.join(holdingsDir, snapshots[0].name);
}

function buildPromptPacket(snapshot) {
  return [
    "# ChatGPT Manual Mode Prompt",
    "",
    "Use the grounded portfolio data below to produce a weekly portfolio intelligence report.",
    "",
    "Rules:",
    "- Stay fully grounded in the provided data and cited public evidence only.",
    "- Use the same structure each week.",
    "- For each stock, include original buy price, current price, quantity, current value, all-time P&L, all-time return, weekly transaction note, sentiment, and a short why-it-may-be-moving section.",
    "- Be transparent when brokerage coverage is limited.",
    "- Do not invent trades if weekly trades are missing.",
    "- Do not give personalized financial advice.",
    "",
    "Desired output sections:",
    "1. Portfolio summary",
    "2. One section per stock",
    "3. Brokerage consensus line per stock",
    "4. Key risks and watchpoints",
    "",
    "Grounded input:",
    "```json",
    JSON.stringify(snapshot, null, 2),
    "```",
    "",
  ].join("\n");
}

export async function prepareForChatGpt({ config, snapshotPath }) {
  const resolvedSnapshotPath = await resolveSnapshotPath(config, snapshotPath);
  const snapshot = JSON.parse(await readFile(resolvedSnapshotPath, "utf8"));
  const outputDir = path.join(config.paths.outputDir, "manual-chatgpt-packet");
  await mkdir(outputDir, { recursive: true });

  const promptPath = path.join(outputDir, "chatgpt_prompt.md");
  const snapshotCopyPath = path.join(outputDir, "snapshot.json");
  const previewPath = path.join(outputDir, "snapshot_preview.md");

  await writeFile(promptPath, buildPromptPacket(snapshot), "utf8");
  await writeFile(snapshotCopyPath, JSON.stringify(snapshot, null, 2), "utf8");
  await writeFile(
    previewPath,
    buildMarkdownReport({
      generatedAt: snapshot.generatedAt,
      period: "snapshot",
      summary: {
        holdingsCount: snapshot.holdings.length,
        totalValue: snapshot.holdings.reduce((sum, item) => sum + item.currentValue, 0),
        totalPnl: snapshot.holdings.reduce((sum, item) => sum + item.pnl, 0),
        sentimentCounts: {
          bullish: 0,
          neutral: 0,
          cautious: 0,
          unclear: snapshot.holdings.length,
        },
      },
      holdings: snapshot.holdings.map((holding) => ({
        ...holding,
        summary: {
          sentiment: "unclear",
          confidence: "low",
          keyDevelopments: ["Use this snapshot with ChatGPT to create the final grounded write-up."],
          whyMoving: "Manual mode packet only; no AI summary has been generated yet.",
          watchpoints: ["Add external evidence and generated narrative in ChatGPT."],
          missingEvidence: ["No AI summarization has been run in this packet."],
          rationale: "This preview exists only to help inspect the snapshot before pasting it into ChatGPT.",
          citations: [],
        },
        weeklyActivity: holding.weeklyActivity || {
          tradesCount: 0,
          buyQty: 0,
          sellQty: 0,
          netQty: 0,
          buyValue: 0,
          sellValue: 0,
          exactWeeklyPnl: null,
          weeklyPnlMethod: "unknown",
          transactions: [],
        },
        brokerageConsensus: holding.brokerageConsensus || {
          scannedCount: 0,
          buy: 0,
          hold: 0,
          sell: 0,
          coverageNote: "No brokerage scan in snapshot-only manual mode.",
          items: [],
        },
      })),
    }),
    "utf8"
  );

  return {
    outputDir,
    promptPath,
    snapshotCopyPath,
    previewPath,
  };
}
