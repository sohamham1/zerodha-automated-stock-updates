function buildPrompt(holding, evidence) {
  return [
    "Generate a source-grounded weekly stock intelligence memo in JSON.",
    "Do not give personalized financial advice.",
    "If evidence is sparse, use sentiment 'unclear'.",
    "Only cite URLs provided below.",
    "Return JSON with keys: sentiment, confidence, keyDevelopments, whyMoving, watchpoints, missingEvidence, rationale, citations.",
    "",
    JSON.stringify(
      {
        holding: {
          symbol: holding.symbol,
          companyName: holding.companyName,
          exchange: holding.exchange,
          isin: holding.isin,
          quantity: holding.quantity,
          averagePrice: holding.averagePrice,
          lastPrice: holding.lastPrice,
          weeklyChangePct: holding.weeklyChangePct,
          portfolioWeight: holding.portfolioWeight,
          pnl: holding.pnl,
        },
        evidence,
      },
      null,
      2
    ),
  ].join("\n");
}

export class GeminiSummarizer {
  constructor(config) {
    this.config = config;
  }

  async summarize(holding, evidence) {
    const active = this.config.llm.active;
    const url = `${active.baseUrl}/models/${active.model}:generateContent?key=${encodeURIComponent(
      active.apiKey
    )}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt(holding, evidence) }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini summarizer failed with ${response.status}: ${body}`);
    }

    const json = await response.json();
    const text =
      json.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") ||
      "";
    return JSON.parse(text);
  }
}
