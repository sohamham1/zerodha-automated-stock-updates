const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "sentiment",
    "confidence",
    "keyDevelopments",
    "whyMoving",
    "watchpoints",
    "missingEvidence",
    "rationale",
    "citations",
  ],
  properties: {
    sentiment: {
      type: "string",
      enum: ["bullish", "neutral", "cautious", "unclear"],
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
    },
    keyDevelopments: {
      type: "array",
      items: { type: "string" },
      maxItems: 7,
    },
    whyMoving: { type: "string" },
    watchpoints: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
    },
    missingEvidence: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
    },
    rationale: { type: "string" },
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url", "source"],
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          source: { type: "string" },
        },
      },
      maxItems: 8,
    },
  },
};

function extractTextPayload(responseJson) {
  if (responseJson.output_text) {
    return responseJson.output_text;
  }

  const output = responseJson.output || [];
  for (const block of output) {
    for (const item of block.content || []) {
      if (item.type === "output_text" && item.text) {
        return item.text;
      }
      if (item.type === "text" && item.text) {
        return item.text;
      }
    }
  }
  throw new Error("OpenAI response did not include text output.");
}

export class OpenAiSummarizer {
  constructor(config) {
    this.config = config;
  }

  async summarize(holding, evidence) {
    const active = this.config.llm.active;
    const response = await fetch(
      `${active.baseUrl || "https://api.openai.com/v1"}/responses`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${active.apiKey}`,
        },
        body: JSON.stringify({
          model: active.model,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text:
                    "You are generating a source-grounded weekly stock intelligence memo. Do not give personalized financial advice. If evidence is sparse, use sentiment 'unclear'. Only cite URLs provided in the evidence list.",
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: JSON.stringify(
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
                        maxKeyDevelopments: 7,
                        requireSourceGrounding: true,
                      },
                    },
                    null,
                    2
                  ),
                },
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "stock_weekly_brief",
              strict: true,
              schema: RESPONSE_SCHEMA,
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI summarizer failed with ${response.status}: ${body}`);
    }

    const responseJson = await response.json();
    return JSON.parse(extractTextPayload(responseJson));
  }
}
