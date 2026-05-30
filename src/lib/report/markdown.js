function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatPct(value) {
  return `${(value || 0).toFixed(2)}%`;
}

function sectionList(items) {
  if (!items || items.length === 0) {
    return "- None\n";
  }
  return items.map((item) => `- ${item}`).join("\n") + "\n";
}

function renderBrokerageLine(consensus) {
  if (!consensus || !consensus.scannedCount) {
    return "Public brokerage consensus was not available for this stock in the current scan.";
  }

  const sellCount = consensus.sell;
  return `Of the ${consensus.scannedCount} brokerage recommendation items scanned, ${consensus.buy} advise a buy position, ${consensus.hold} advise a hold position, and ${sellCount} advise a sell position. ${consensus.coverageNote}`;
}

export function buildMarkdownReport(report) {
  const lines = [];
  lines.push("# Weekly Portfolio Intelligence Report");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Period: ${report.period}`);
  lines.push("");
  lines.push("## Portfolio Summary");
  lines.push("");
  lines.push(`- Holdings covered: ${report.summary.holdingsCount}`);
  lines.push(`- Portfolio value: ${formatCurrency(report.summary.totalValue)}`);
  lines.push(`- Total P&L: ${formatCurrency(report.summary.totalPnl)}`);
  lines.push(`- Bullish: ${report.summary.sentimentCounts.bullish}`);
  lines.push(`- Neutral: ${report.summary.sentimentCounts.neutral}`);
  lines.push(`- Cautious: ${report.summary.sentimentCounts.cautious}`);
  lines.push(`- Unclear: ${report.summary.sentimentCounts.unclear}`);
  lines.push("");

  for (const stock of report.holdings) {
    lines.push(`## ${stock.companyName} (${stock.exchange}:${stock.symbol})`);
    lines.push("");
    lines.push(`- Quantity: ${stock.quantity}`);
    lines.push(`- Original average buy price: ${formatCurrency(stock.averagePrice)}`);
    lines.push(`- Last price: ${formatCurrency(stock.lastPrice)}`);
    lines.push(`- Current return: ${formatCurrency(stock.pnl)} (${formatPct(stock.returnPct)})`);
    lines.push(`- Current value: ${formatCurrency(stock.currentValue)}`);
    lines.push(`- Weight: ${stock.portfolioWeight.toFixed(2)}%`);
    lines.push(`- Weekly move: ${formatPct(stock.weeklyChangePct)}`);
    lines.push(`- Sentiment: ${stock.summary.sentiment}`);
    lines.push(`- Confidence: ${stock.summary.confidence}`);
    lines.push("");
    lines.push("### Portfolio Ground Truth");
    lines.push(`- Opening quantity this day: ${stock.openingQuantity}`);
    lines.push(`- Realised quantity in holdings: ${stock.realisedQuantity}`);
    lines.push(`- Used quantity sold from holdings: ${stock.usedQuantity}`);
    lines.push("");
    lines.push("### Weekly Transactions");
    if (!stock.weeklyActivity || stock.weeklyActivity.tradesCount === 0) {
      lines.push("- No CNC equity transactions for this stock were captured in cached data this week.");
    } else {
      lines.push(`- Transactions captured this week: ${stock.weeklyActivity.tradesCount}`);
      lines.push(`- Bought this week: ${stock.weeklyActivity.buyQty} shares for ${formatCurrency(stock.weeklyActivity.buyValue)}`);
      lines.push(`- Sold this week: ${stock.weeklyActivity.sellQty} shares for ${formatCurrency(stock.weeklyActivity.sellValue)}`);
      lines.push(`- Net quantity change this week: ${stock.weeklyActivity.netQty}`);
      if (stock.weeklyActivity.exactWeeklyPnl === null) {
        lines.push("- Weekly P&L: unavailable exactly because no week-start cached holdings baseline was found yet.");
      } else {
        lines.push(`- Weekly realised P&L: ${formatCurrency(stock.weeklyActivity.exactWeeklyPnl)} (${stock.weeklyActivity.weeklyPnlMethod})`);
      }
      for (const transaction of stock.weeklyActivity.transactions.slice(0, 8)) {
        lines.push(
          `- ${transaction.timestamp}: ${transaction.transactionType} ${transaction.quantity} @ ${formatCurrency(transaction.averagePrice)}`
        );
      }
    }
    lines.push("");
    lines.push("### Brokerage Consensus");
    lines.push(renderBrokerageLine(stock.brokerageConsensus));
    if (stock.brokerageConsensus?.items?.length) {
      lines.push("");
      for (const item of stock.brokerageConsensus.items.slice(0, 10)) {
        lines.push(
          `- ${item.broker}: ${item.rating.toUpperCase()} via [${item.title}](${item.url})`
        );
      }
    }
    lines.push("");
    lines.push("### What Happened");
    lines.push(sectionList(stock.summary.keyDevelopments));
    lines.push("### Why It May Be Moving");
    lines.push(stock.summary.whyMoving);
    lines.push("");
    lines.push("### Watchpoints");
    lines.push(sectionList(stock.summary.watchpoints));
    lines.push("### Missing Evidence");
    lines.push(sectionList(stock.summary.missingEvidence));
    lines.push("### Rationale");
    lines.push(stock.summary.rationale);
    lines.push("");
    lines.push("### Sources");
    if (!stock.summary.citations?.length) {
      lines.push("- No linked sources captured");
    } else {
      for (const citation of stock.summary.citations) {
        lines.push(`- [${citation.title}](${citation.url}) - ${citation.source}`);
      }
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(
    "This report is for informational use only and should not be treated as personalized investment advice."
  );
  lines.push("");

  return lines.join("\n");
}
