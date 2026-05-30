import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/lib/config.js";

test("loadConfig picks anthropic provider from env", async () => {
  process.env.LLM_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
  process.env.ANTHROPIC_MODEL = "claude-3-5-haiku-latest";

  const config = await loadConfig(process.cwd(), {});

  assert.equal(config.llm.provider, "anthropic");
  assert.equal(config.llm.active.apiKey, "anthropic-test-key");
  assert.equal(config.llm.active.model, "claude-3-5-haiku-latest");

  delete process.env.LLM_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_MODEL;
});
