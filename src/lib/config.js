import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_CONFIG = {
  outputDir: "artifacts",
  cacheDir: ".cache",
  report: {
    includePdf: true,
    formats: ["json", "md", "xlsx", "pdf"],
  },
  kite: {
    command: "npx",
    args: ["mcp-remote", "https://mcp.kite.trade/mcp"],
  },
  news: {
    enabled: true,
    perQueryLimit: 4,
    queries: [
      "general",
      "dividend",
      "promoter shareholding",
      "shareholder meeting",
      "investor presentation",
      "annual report",
    ],
  },
  llm: {
    provider: "openai",
    providers: {
      openai: {
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
      },
      anthropic: {
        model: "claude-3-5-haiku-latest",
        baseUrl: "https://api.anthropic.com/v1",
      },
      gemini: {
        model: "gemini-2.0-flash",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      },
    },
  },
};

function mergeConfig(base, override) {
  const sanitizedOverride = {};
  for (const [key, value] of Object.entries(override || {})) {
    if (value !== undefined) {
      sanitizedOverride[key] = value;
    }
  }

  const next = { ...base, ...sanitizedOverride };
  for (const key of Object.keys(next)) {
    if (
      base[key] &&
      sanitizedOverride[key] &&
      typeof base[key] === "object" &&
      typeof sanitizedOverride[key] === "object" &&
      !Array.isArray(base[key]) &&
      !Array.isArray(sanitizedOverride[key])
    ) {
      next[key] = mergeConfig(base[key], sanitizedOverride[key]);
    }
  }
  return next;
}

async function loadEnvFile(cwd, profile) {
  const envFiles = [];
  if (profile && profile !== "default") {
    envFiles.push(path.join(cwd, `.env.${profile}`));
  }
  envFiles.push(path.join(cwd, ".env"));

  const loadedKeys = new Set();

  for (const envPath of envFiles) {
    try {
      await access(envPath);
    } catch {
      continue;
    }

    const content = await readFile(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const pivot = line.indexOf("=");
      if (pivot === -1) {
        continue;
      }
      const key = line.slice(0, pivot).trim();
      const value = line.slice(pivot + 1).trim();
      if (!loadedKeys.has(key)) {
        process.env[key] = value;
        loadedKeys.add(key);
      }
    }
  }
}

export async function loadConfig(cwd, cliFlags = {}) {
  const profile = cliFlags.profile || "default";
  await loadEnvFile(cwd, profile);

  let fileConfig = {};
  const configPath = path.join(cwd, "portfolio-intelligence.config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    fileConfig = JSON.parse(raw);
  } catch {
    fileConfig = {};
  }

  const envConfig = {
    kite: {
      command: process.env.KITE_MCP_COMMAND,
      args: process.env.KITE_MCP_ARGS
        ? process.env.KITE_MCP_ARGS.split(" ")
        : undefined,
    },
    llm: {
      provider:
        process.env.LLM_PROVIDER ||
        (process.env.OPENAI_API_KEY
          ? "openai"
          : process.env.ANTHROPIC_API_KEY
            ? "anthropic"
            : process.env.GEMINI_API_KEY
              ? "gemini"
              : "heuristic"),
      providers: {
        openai: {
          model: process.env.OPENAI_MODEL,
          apiKey: process.env.OPENAI_API_KEY,
          baseUrl: process.env.OPENAI_BASE_URL,
        },
        anthropic: {
          model: process.env.ANTHROPIC_MODEL,
          apiKey: process.env.ANTHROPIC_API_KEY,
          baseUrl: process.env.ANTHROPIC_BASE_URL,
        },
        gemini: {
          model: process.env.GEMINI_MODEL,
          apiKey: process.env.GEMINI_API_KEY,
          baseUrl: process.env.GEMINI_BASE_URL,
        },
      },
    },
    python: {
      executable: process.env.PYTHON_EXECUTABLE,
    },
  };

  const merged = mergeConfig(DEFAULT_CONFIG, fileConfig);
  const config = mergeConfig(merged, envConfig);

  if (cliFlags["output-dir"]) {
    config.outputDir = cliFlags["output-dir"];
  }
  if (cliFlags["include-pdf"]) {
    config.report.includePdf = true;
  }
  if (cliFlags.notify) {
    config.notify = true;
  }

  config.llm.active = config.llm.providers?.[config.llm.provider] || null;

  config.profile = profile;
  config.cwd = cwd;
  
  const profileSubdir = profile !== "default" ? profile : "";
  config.paths = {
    outputDir: path.resolve(cwd, config.outputDir, profileSubdir),
    cacheDir: path.resolve(cwd, config.cacheDir, profileSubdir),
  };

  await mkdir(config.paths.outputDir, { recursive: true });
  await mkdir(config.paths.cacheDir, { recursive: true });

  return config;
}
