import { finalizeHoldingSummary } from "../report/presentation.js";

export class HeuristicSummarizer {
  async summarize(holding, evidence, reportDate = new Date()) {
    return finalizeHoldingSummary({
      holding,
      evidence,
      rawSummary: null,
      reportDate: reportDate instanceof Date ? reportDate : new Date(reportDate),
    });
  }
}
