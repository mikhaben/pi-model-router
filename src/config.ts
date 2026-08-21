import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILENAME = "pi-model-router.json";

/** `<agentDir>/extension-settings/<package>.json` is the convention pi extensions follow. */
export function configPath(agentDir: string): string {
  return join(agentDir, "extension-settings", CONFIG_FILENAME);
}

export interface ChainEntry {
  provider: string;
  modelId: string;
  raw: string;
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

    const slash = entry.indexOf("/");
    if (slash <= 0 || slash === entry.length - 1) {
      warnings.push(`invalid chain entry ${entryLabel(entry)}: expected provider/model-id`);
      continue;
    }

    const provider = entry.slice(0, slash);
    const modelId = entry.slice(slash + 1);
    chain.push({ provider, modelId, raw: entry });
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
