import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configPath, loadConfig, parseConfig } from "../src/config.js";

describe("config", () => {
  it("splits a model id at its first slash", () => {
    expect(parseConfig(JSON.stringify({ chain: ["vercel-ai-gateway/minimax/minimax-m3"] }))).toEqual({
      chain: [{
        provider: "vercel-ai-gateway",
        modelId: "minimax/minimax-m3",
        raw: "vercel-ai-gateway/minimax/minimax-m3",
      }],
      warnings: [],
    });
  });

  it("leaves a single colon alone; only :: introduces a thinking level", () => {
    const loaded = parseConfig(JSON.stringify({
      chain: [
        "openrouter/poolside/laguna-s-2.1:free",
        "openrouter/openai/gpt-5.6-luna:batch",
        "openrouter/poolside/laguna-s-2.1:free::high",
      ],
    }));

    expect(loaded.chain).toEqual([
      {
        provider: "openrouter",
        modelId: "poolside/laguna-s-2.1:free",
        raw: "openrouter/poolside/laguna-s-2.1:free",
      },
      {
        provider: "openrouter",
        modelId: "openai/gpt-5.6-luna:batch",
        raw: "openrouter/openai/gpt-5.6-luna:batch",
      },
      {
        provider: "openrouter",
        modelId: "poolside/laguna-s-2.1:free",
        thinking: "high",
        raw: "openrouter/poolside/laguna-s-2.1:free",
      },
    ]);
    expect(loaded.warnings).toEqual([]);
  });

  it("reads a trailing thinking level and strips it from the model id", () => {
    const loaded = parseConfig(JSON.stringify({
      chain: ["openai-codex/gpt-5.6-luna::max", "opencode/hy3-free::low"],
    }));

    expect(loaded.chain).toEqual([
      {
        provider: "openai-codex",
        modelId: "gpt-5.6-luna",
        thinking: "max",
        raw: "openai-codex/gpt-5.6-luna",
      },
      {
        provider: "opencode",
        modelId: "hy3-free",
        thinking: "low",
        raw: "opencode/hy3-free",
      },
    ]);
  });

  it("warns about an unknown thinking level and keeps the model usable", () => {
    const loaded = parseConfig(JSON.stringify({ chain: ["opencode/hy3-free::maxx"] }));

    expect(loaded.chain).toEqual([
      { provider: "opencode", modelId: "hy3-free", raw: "opencode/hy3-free" },
    ]);
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.warnings[0]).toContain("maxx");
  });

  it("warns for a malformed entry and preserves valid entries", () => {
    const loaded = parseConfig(JSON.stringify({
      chain: ["opencode/hy3-free", "not-a-model", 42, "vercel-ai-gateway/minimax/minimax-m3"],
    }));

    expect(loaded.chain.map((entry) => entry.raw)).toEqual([
      "opencode/hy3-free",
      "vercel-ai-gateway/minimax/minimax-m3",
    ]);
    expect(loaded.warnings).toHaveLength(2);
    expect(loaded.warnings[0]).toContain("not-a-model");
    expect(loaded.warnings[1]).toContain("42");
  });

  it("returns a warning instead of throwing for missing and invalid config", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-model-router-config-"));
    expect(loadConfig(agentDir)).toEqual({
      chain: [],
      warnings: [`config not found at ${configPath(agentDir)}`],
    });

    const path = configPath(agentDir);
    mkdirSync(join(agentDir, "extension-settings"));
    writeFileSync(path, "{", "utf8");
    const loaded = loadConfig(agentDir);
    expect(loaded.chain).toEqual([]);
    expect(loaded.warnings[0]).toMatch(/^invalid JSON:/);
  });
});
