import { describe, expect, it } from "vitest";
import type { ChainEntry } from "../src/config.js";
import { nextEligible } from "../src/router.js";

const chain: ChainEntry[] = [
  { provider: "one", modelId: "a", raw: "one/a" },
  { provider: "two", modelId: "b", raw: "two/b" },
  { provider: "three", modelId: "c", raw: "three/c" },
];

describe("chain selection", () => {
  it("skips attempted and cooling entries", () => {
    expect(nextEligible(
      chain,
      new Set(["one/a"]),
      new Map([["two/b", "2026-08-22T00:00:00.000Z"]]),
      Date.parse("2026-08-20T12:00:00.000Z"),
      undefined,
    )).toEqual(chain[2]);
  });

  it("allows an expired cooldown", () => {
    expect(nextEligible(
      chain,
      new Set(),
      new Map([["one/a", "2026-08-19T00:00:00.000Z"]]),
      Date.parse("2026-08-20T12:00:00.000Z"),
      undefined,
    )).toEqual(chain[0]);
  });

  it("returns undefined when every entry is exhausted", () => {
    expect(nextEligible(
      chain,
      new Set(chain.map((entry) => entry.raw)),
      new Map(),
      Date.parse("2026-08-20T12:00:00.000Z"),
      undefined,
    )).toBeUndefined();
  });
});
