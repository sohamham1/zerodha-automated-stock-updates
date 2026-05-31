import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const PROVIDERS = {
  openai: {
    label: "OpenAI",
    modelKey: "OPENAI_MODEL",
    modelDefault: "gpt-4.1-mini",
    keyName: "OPENAI_API_KEY",
    baseUrlKey: "OPENAI_BASE_URL",
    baseUrlDefault: "https://api.openai.com/v1",
  },
  anthropic: {
    label: "Claude",
    modelKey: "ANTHROPIC_MODEL",
    modelDefault: "claude-3-5-haiku-latest",
    keyName: "ANTHROPIC_API_KEY",
    baseUrlKey: "ANTHROPIC_BASE_URL",
    baseUrlDefault: "https://api.anthropic.com/v1",
  },
  gemini: {
    label: "Gemini",
    modelKey: "GEMINI_MODEL",
    modelDefault: "gemini-2.0-flash",
    keyName: "GEMINI_API_KEY",
    baseUrlKey: "GEMINI_BASE_URL",
    baseUrlDefault: "https://generativelanguage.googleapis.com/v1beta",
  },
};

async function readExistingEnv(envPath) {
  try {
    await access(envPath);
  } catch {
    return {};
  }

  const content = await readFile(envPath, "utf8");
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const pivot = line.indexOf("=");
    if (pivot === -1) {
      continue;
    }
    values[line.slice(0, pivot).trim()] = line.slice(pivot + 1).trim();
  }
  return values;
}

function buildEnvContent(values) {
  const lines = [
    `LLM_PROVIDER=${values.LLM_PROVIDER || "openai"}`,
    `OPENAI_API_KEY=${values.OPENAI_API_KEY || ""}`,
    `OPENAI_MODEL=${values.OPENAI_MODEL || "gpt-4.1-mini"}`,
    `OPENAI_BASE_URL=${values.OPENAI_BASE_URL || "https://api.openai.com/v1"}`,
    `ANTHROPIC_API_KEY=${values.ANTHROPIC_API_KEY || ""}`,
    `ANTHROPIC_MODEL=${values.ANTHROPIC_MODEL || "claude-3-5-haiku-latest"}`,
    `ANTHROPIC_BASE_URL=${values.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1"}`,
    `GEMINI_API_KEY=${values.GEMINI_API_KEY || ""}`,
    `GEMINI_MODEL=${values.GEMINI_MODEL || "gemini-2.0-flash"}`,
    `GEMINI_BASE_URL=${values.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta"}`,
    `KITE_MCP_COMMAND=${values.KITE_MCP_COMMAND || "npx"}`,
    `KITE_MCP_ARGS=${values.KITE_MCP_ARGS || "mcp-remote https://mcp.kite.trade/mcp"}`,
    `PYTHON_EXECUTABLE=${values.PYTHON_EXECUTABLE || "python"}`,
  ];
  return lines.join("\n") + "\n";
}

async function askProvider(rl) {
  while (true) {
    const answer = (
      await rl.question(
        "Choose your AI provider: 1) OpenAI  2) Claude  3) Gemini\nEnter 1, 2, or 3: "
      )
    )
      .trim()
      .toLowerCase();

    if (answer === "1" || answer === "openai") {
      return "openai";
    }
    if (answer === "2" || answer === "claude" || answer === "anthropic") {
      return "anthropic";
    }
    if (answer === "3" || answer === "gemini") {
      return "gemini";
    }
    console.log("Please enter 1, 2, or 3.");
  }
}

export async function runInteractiveSetup(cwd, profile = "default") {
  const isDefault = !profile || profile === "default";
  const envPath = isDefault ? path.join(cwd, ".env") : path.join(cwd, `.env.${profile}`);
  const existing = await readExistingEnv(envPath);
  const rl = createInterface({ input, output });

  try {
    console.log(`Portfolio Weekly Intelligence Reporter setup [Profile: ${profile}]`);
    console.log("This saves your settings locally on this machine only.");
    console.log("");

    const provider = await askProvider(rl);
    const providerMeta = PROVIDERS[provider];
    const currentKey = existing[providerMeta.keyName] || "";
    const currentModel = existing[providerMeta.modelKey] || providerMeta.modelDefault;
    const pythonExecutable = (
      await rl.question(
        `Python command for Excel/PDF export [${existing.PYTHON_EXECUTABLE || "python"}]: `
      )
    ).trim();

    const apiKey = (
      await rl.question(
        `${providerMeta.label} API key${currentKey ? " [press Enter to keep existing]" : ""}: `
      )
    ).trim();

    const model = (
      await rl.question(
        `${providerMeta.label} model [${currentModel}]: `
      )
    ).trim();

    const values = {
      ...existing,
      LLM_PROVIDER: provider,
      PYTHON_EXECUTABLE: pythonExecutable || existing.PYTHON_EXECUTABLE || "python",
      [providerMeta.keyName]: apiKey || currentKey,
      [providerMeta.modelKey]: model || currentModel,
      [providerMeta.baseUrlKey]:
        existing[providerMeta.baseUrlKey] || providerMeta.baseUrlDefault,
      KITE_MCP_COMMAND: existing.KITE_MCP_COMMAND || "npx",
      KITE_MCP_ARGS:
        existing.KITE_MCP_ARGS || "mcp-remote https://mcp.kite.trade/mcp",
    };

    await writeFile(envPath, buildEnvContent(values), "utf8");
  } finally {
    rl.close();
  }
}
