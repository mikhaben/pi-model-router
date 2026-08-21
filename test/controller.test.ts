import { describe, expect, it } from "vitest";
import type { ChainEntry } from "../src/config.js";
import { type ControllerDeps, type PiModel, RouterController } from "../src/controller.js";
import { RouterStore } from "../src/store.js";

const chain: ChainEntry[] = [
  { provider: "one", modelId: "a", raw: "one/a" },
  { provider: "two", modelId: "b", raw: "two/b" },
  { provider: "three", modelId: "c", raw: "three/c" },
];

type Harness = {
  controller: RouterController;
  store: RouterStore;
  setCalls: string[];
  continues: number;
  notifications: Array<{ message: string; type: string }>;
  statuses: Array<string | undefined>;
  setCurrent(raw: string | undefined): void;
};

function makeHarness(options: {
  store?: RouterStore;
  falseRaws?: string[];
  currentRaw?: string;
} = {}): Harness {
  const store = options.store ?? new RouterStore(":memory:");
  const falseRaws = new Set(options.falseRaws ?? []);
  const models = new Map<string, PiModel>(chain.map((entry) => [entry.raw, {} as PiModel]));
  const modelRaws = new Map<PiModel, string>(
    [...models.entries()].map(([raw, model]) => [model, raw]),
  );
  let currentRaw: string | undefined = options.currentRaw ?? "one/a";
  const setCalls: string[] = [];
  const notifications: Array<{ message: string; type: string }> = [];
  const statuses: Array<string | undefined> = [];
  let continues = 0;

  const deps: ControllerDeps = {
    resolveModel: (entry) => models.get(entry.raw),
    setModel: async (model) => {
      const raw = modelRaws.get(model)!;
      setCalls.push(raw);
      if (falseRaws.has(raw)) return false;
      currentRaw = raw;
      return true;
    },
    currentModel: () => {
      if (!currentRaw) return undefined;
      const slash = currentRaw.indexOf("/");
      return { provider: currentRaw.slice(0, slash), id: currentRaw.slice(slash + 1) };
    },
    sendContinue: () => {
      continues++;
    },
    notify: (message, type) => {
      notifications.push({ message, type });
    },
    setStatus: (text) => {
      statuses.push(text);
    },
    store,
    now: () => Date.parse("2026-08-20T12:00:00.000Z"),
  };

  return {
    controller: new RouterController(chain, deps),
    store,
    setCalls,
    get continues() {
      return continues;
    },
    notifications,
    statuses,
    setCurrent: (raw) => { currentRaw = raw; },
  };
}

describe("RouterController", () => {
  it("does nothing until armed, then routes a chain-member failure", async () => {
    const harness = makeHarness();
    harness.controller.noteAssistantMessage("error", "429 FreeUsageLimitError: daily limit");
    await harness.controller.onSettled();
    expect(harness.setCalls).toEqual([]);

    await harness.controller.activate();
    harness.controller.noteAssistantMessage("error", "429 FreeUsageLimitError: daily limit");
    await harness.controller.onSettled();

    expect(harness.setCalls).toEqual(["two/b"]);
    expect(harness.continues).toBe(1);
    expect(harness.statuses.at(-1)).toBe("two/b (1 cooling)");
    expect(harness.store.recentEvents("2026-08-20T00:00:00.000Z").map((event) => event.kind)).toEqual([
      "limit",
      "switch",
    ]);
    expect(harness.store.recentEvents("2026-08-20T00:00:00.000Z")[0].cooldownUntil).toBe(
      "2026-08-21T00:00:00.000Z",
    );
    harness.store.close();
  });

  it("advances twice and then stops without another Continue", async () => {
    const harness = makeHarness();
    await harness.controller.activate();
    for (const message of [
      "429 FreeUsageLimitError: first",
      "429 FreeUsageLimitError: second",
      "429 FreeUsageLimitError: third",
    ]) {
      harness.controller.noteAssistantMessage("error", message);
      await harness.controller.onSettled();
    }

    expect(harness.setCalls).toEqual(["two/b", "three/c"]);
    expect(harness.continues).toBe(2);
    expect(harness.notifications.some(({ message }) => message.includes("model-router chain exhausted"))).toBe(true);
    harness.store.close();
  });

  it("resets attempts for interactive input but keeps cooldowns", async () => {
    const harness = makeHarness();
    await harness.controller.activate();
    harness.controller.noteAssistantMessage("error", "429 FreeUsageLimitError: daily limit");
    await harness.controller.onSettled();
    harness.controller.noteUserInput("interactive");
    await harness.controller.advance("manual");

    expect(harness.setCalls).toEqual(["two/b", "three/c"]);
    expect(harness.store.activeCooldowns("2026-08-20T12:00:00.000Z").has("one/a")).toBe(true);
    harness.store.close();
  });

  it("skips a model when setModel returns false", async () => {
    const harness = makeHarness({ falseRaws: ["two/b"] });
    await harness.controller.activate();
    await harness.controller.advance("manual");

    expect(harness.setCalls).toEqual(["two/b", "three/c"]);
    expect(harness.store.recentEvents("2026-08-20T00:00:00.000Z").map((event) => event.kind)).toEqual([
      "error",
      "switch",
    ]);
    harness.store.close();
  });

  it("never routes a failure of a model outside the chain, even when armed", async () => {
    const harness = makeHarness();
    await harness.controller.activate();
    harness.setCurrent("anthropic/claude-opus-5");
    harness.controller.noteAssistantMessage("error", "429 FreeUsageLimitError: daily limit");
    await harness.controller.onSettled();

    expect(harness.setCalls).toEqual([]);
    expect(harness.store.recentEvents("2026-08-20T00:00:00.000Z")).toEqual([]);
    harness.store.close();
  });

  it("does not route an aborted run", async () => {
    const harness = makeHarness();
    await harness.controller.activate();
    harness.controller.noteAssistantMessage("aborted", "cancelled");
    await harness.controller.onSettled();

    expect(harness.setCalls).toEqual([]);
    expect(harness.store.recentEvents("2026-08-20T00:00:00.000Z")).toEqual([]);
    harness.store.close();
  });

  it("seeds cooldowns from the store before the first advance", async () => {
    const store = new RouterStore(":memory:");
    store.record({
      at: "2026-08-20T11:00:00.000Z",
      provider: "two",
      model: "b",
      kind: "limit",
      cooldownUntil: "2026-08-21T00:00:00.000Z",
    });
    const harness = makeHarness({ store });
    await harness.controller.activate();
    await harness.controller.advance("manual");

    expect(harness.setCalls).toEqual(["three/c"]);
    store.close();
  });

  it("lists current, cooling, and plain entries in config order", () => {
    const store = new RouterStore(":memory:");
    store.record({
      at: "2026-08-20T11:00:00.000Z",
      provider: "two",
      model: "b",
      kind: "limit",
      cooldownUntil: "2026-08-21T00:00:00.000Z",
    });
    const harness = makeHarness({ store });
    const lines = harness.controller.statusText().split("\n");

    expect(lines).toEqual([
      "> one/a (0 limits today)",
      "x cooling until 2026-08-21T00:00:00.000Z two/b (1 limits today)",
      "- three/c (0 limits today)",
    ]);
    store.close();
  });
});
