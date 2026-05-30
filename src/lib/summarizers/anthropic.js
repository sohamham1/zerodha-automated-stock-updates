function buildPromptPayload(holding, evidence) {
  return JSON.stringify(
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
      instructions: {
        purpose:
          "Generate a source-grounded weekly stock intelligence memo, not personalized financial advice.",
        sentimentValues: ["bullish", "neutral", "cautious", "unclear"],
        citeOnlyProvidedUrls: true,
      },
    },
    null,
    2
  );
}

function buildSystemPrompt() {
  return [
    "Return valid JSON only.",
    "If evidence is sparse, use sentiment 'unclear'.",
    "Do not invent citations or facts.",
    "Schema:",
    JSON.stringify(
      {
        sentiment: "bullish | neutral | cautious | unclear",
        confidence: "low | medium | high",
        keyDevelopments: ["string"],
        whyMoving: "string",
        watchpoints: ["string"],
        missingEvidence: ["string"],
        rationale: "string",
        citations: [{ title: "string", url: "string", source: "string" }],
      },
      null,
      2
    ),
  ].join("\n");
}

export class AnthropicSummarizer {
  constructor(config) {
    this.config = config;
  }

  async summarize(holding, evidence) {
    const active = this.config.llm.active;
    const response = await fetch(`${active.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": active.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: active.model,
        max_tokens: 1200,
        system: buildSystemPrompt(),
        messages: [
          {
            role: "user",
            content: buildPromptPayload(holding, evidence),
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic summarizer failed with ${response.status}: ${body}`);
    }

    const json = await response.json();
    const text = (json.content || [])
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n")
      .trim();

    return JSON.parse(text);
  }
}
