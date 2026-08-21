import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILENAME = "pi-model-router.json";

/** `<agentDir>/extension-settings/<package>.json` is the convention pi extensions follow. */
export function configPath(agentDir: string): string {
  return join(agentDir, "extension-settings", CONFIG_FILENAME);
}

/** pi's thinking levels, in pi's own order. */
const THINKING_LEVELS = new Set([
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
]);

/**
 * Separates a model id from an optional thinking level. Doubled deliberately:
 * a single colon already belongs to model ids such as `laguna-s-2.1:free`.
 */
const THINKING_SEPARATOR = "::";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ChainEntry {
  provider: string;
  modelId: string;
  /** Applied after switching to this entry; absent leaves the session level alone. */
  thinking?: ThinkingLevel;
  raw: string;
}

/** Split `provider/model-id::level` into its parts. An unknown level is reported, not applied. */
function splitThinking(entry: string): { model: string; thinking?: ThinkingLevel; badLevel?: string } {
  const at = entry.lastIndexOf(THINKING_SEPARATOR);
  if (at <= 0) return { model: entry };
  const suffix = entry.slice(at + THINKING_SEPARATOR.length);
  const model = entry.slice(0, at);
  if (!THINKING_LEVELS.has(suffix)) return { model, badLevel: suffix };
  return { model, thinking: suffix as ThinkingLevel };
}

export interface LoadedConfig {
  chain: ChainEntry[];
  warnings: string[];
}

function entryLabel(entry: unknown): string {
  return JSON.stringify(entry) ?? String(entry);
}

export function parseConfig(jsonText: string): LoadedConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { chain: [], warnings: [`invalid JSON: ${detail}`] };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { chain: [], warnings: ["config must be a JSON object with an array chain"] };
  }

  const chainValue = (parsed as Record<string, unknown>).chain;
  if (!Array.isArray(chainValue)) {
    return { chain: [], warnings: ["config chain must be an array"] };
  }

  const chain: ChainEntry[] = [];
  const warnings: string[] = [];
  for (const entry of chainValue) {
    if (typeof entry !== "string") {
      warnings.push(`invalid chain entry ${entryLabel(entry)}: expected provider/model-id`);
      continue;
    }

    const { model, thinking, badLevel } = splitThinking(entry);
    if (badLevel !== undefined) {
      warnings.push(
        `invalid thinking level ${entryLabel(badLevel)} in ${entryLabel(entry)}: `
        + `expected one of ${[...THINKING_LEVELS].join(", ")}`,
      );
    }
    const slash = model.indexOf("/");
    if (slash <= 0 || slash === model.length - 1) {
      warnings.push(`invalid chain entry ${entryLabel(entry)}: expected provider/model-id`);
      continue;
    }

    const provider = model.slice(0, slash);
    const modelId = model.slice(slash + 1);
    chain.push({ provider, modelId, ...(thinking ? { thinking } : {}), raw: model });
  }

  return { chain, warnings };
}

export function loadConfig(agentDir: string): LoadedConfig {
  const path = configPath(agentDir);
  try {
    return parseConfig(readFileSync(path, "utf8"));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { chain: [], warnings: [`config not found at ${path}`] };
    }

    const detail = error instanceof Error ? error.message : String(error);
    return { chain: [], warnings: [`could not read config at ${path}: ${detail}`] };
  }
}
