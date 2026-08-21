import type { ChainEntry } from "./config.js";

export function nextEligible(
  chain: ChainEntry[],
  attempted: ReadonlySet<string>,
  cooldowns: ReadonlyMap<string, string>,
  nowMs: number,
  currentRaw: string | undefined,
): ChainEntry | undefined {
  return chain.find((entry) => {
    if (entry.raw === currentRaw || attempted.has(entry.raw)) return false;
    const until = cooldowns.get(entry.raw);
    return until === undefined || Date.parse(until) <= nowMs;
  });
}
