#!/usr/bin/env node

import { loadConfig } from "./lib/config.js";
import { fetchPortfolioSnapshot } from "./lib/pipeline/fetch-portfolio.js";
import { generateWeeklyReport } from "./lib/pipeline/generate-report.js";
import { prepareForChatGpt } from "./lib/pipeline/prepare-for-chatgpt.js";
import { runInteractiveSetup } from "./lib/setup.js";
import { registerSchedule } from "./lib/schedule/schedule-task.js";

function printUsage() {
  console.log(`Usage:
  node ./src/cli.js setup [--profile name]
  node ./src/cli.js portfolio fetch [--profile name]
  node ./src/cli.js report prepare-for-chatgpt [--snapshot path] [--profile name]
  node ./src/cli.js report generate --period weekly [--include-pdf] [--output-dir path] [--profile name]
  node ./src/cli.js schedule register [--frequency weekly|biweekly|monthly] [--profile name]`);
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    i += 1;
  }
  return flags;
}

async function main() {
  const [, , domain, action, ...rest] = process.argv;
  const flags = parseFlags(rest);

  if (domain === "setup") {
    await runInteractiveSetup(process.cwd(), flags.profile);
    const filename = flags.profile && flags.profile !== "default" ? `.env.${flags.profile}` : ".env";
    console.log(`Setup complete. Your local settings were saved to ${filename}.`);
    return;
  }

  const config = await loadConfig(process.cwd(), flags);

  if (domain === "portfolio" && action === "fetch") {
    const snapshot = await fetchPortfolioSnapshot({ config });
    console.log(
      `Saved ${snapshot.holdings.length} holdings to ${snapshot.snapshotPath}`
    );
    return;
  }

  if (domain === "report" && action === "generate") {
    const report = await generateWeeklyReport({
      config,
      period: String(flags.period || "weekly"),
      includePdf: Boolean(flags["include-pdf"]),
    });
    console.log(`Generated report in ${report.outputDir}`);
    return;
  }

  if (domain === "report" && action === "prepare-for-chatgpt") {
    const packet = await prepareForChatGpt({
      config,
      snapshotPath: flags.snapshot ? String(flags.snapshot) : undefined,
    });
    console.log(`Prepared manual-mode packet in ${packet.outputDir}`);
    return;
  }

  if (domain === "schedule" && action === "register") {
    const frequency = flags.frequency || "weekly";
    if (!["weekly", "biweekly", "monthly"].includes(frequency)) {
      console.error(`Error: Invalid frequency '${frequency}'. Must be one of: weekly, biweekly, monthly`);
      process.exitCode = 1;
      return;
    }
    const result = await registerSchedule({
      cwd: process.cwd(),
      profile: config.profile,
      frequency,
    });
    console.log(`[schedule] Successfully registered Windows Task Scheduler task: ${result.taskName}`);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("zerodha-automated-stock-updates failed.");
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
