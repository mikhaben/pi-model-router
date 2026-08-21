import { describe, expect, it } from "vitest";
import { RouterStore } from "../src/store.js";

describe("RouterStore", () => {
  it("records an event with absent optional fields", () => {
    const store = new RouterStore(":memory:");
    expect(() => store.record({
      at: "2026-08-20T12:00:00.000Z",
      provider: "opencode",
      model: "hy3-free",
      kind: "error",
    })).not.toThrow();
    expect(store.recentEvents("2026-08-20T00:00:00.000Z")).toEqual([{
      at: "2026-08-20T12:00:00.000Z",
      provider: "opencode",
      model: "hy3-free",
      kind: "error",
    }]);
    store.close();
  });

  it("returns future cooldowns keyed by provider and model", () => {
    const store = new RouterStore(":memory:");
    store.record({
      at: "2026-08-20T12:00:00.000Z",
      provider: "opencode",
      model: "hy3-free",
      kind: "limit",
      cooldownUntil: "2026-08-21T00:00:00.000Z",
    });

    expect(store.activeCooldowns("2026-08-20T12:00:00.000Z")).toEqual(
      new Map([["opencode/hy3-free", "2026-08-21T00:00:00.000Z"]]),
    );
    store.close();
  });

  it("does not return expired cooldowns", () => {
    const store = new RouterStore(":memory:");
    store.record({
      at: "2026-08-19T12:00:00.000Z",
      provider: "opencode",
      model: "hy3-free",
      kind: "limit",
      cooldownUntil: "2026-08-20T00:00:00.000Z",
    });

    expect(store.activeCooldowns("2026-08-20T00:00:00.000Z")).toEqual(new Map());
    store.close();
  });

  it("returns recent events in insertion order", () => {
    const store = new RouterStore(":memory:");
    store.record({
      at: "2026-08-20T12:00:02.000Z",
      provider: "one",
      model: "a",
      kind: "error",
    });
    store.record({
      at: "2026-08-20T12:00:01.000Z",
      provider: "two",
      model: "b",
      kind: "switch",
    });

    expect(store.recentEvents("2026-08-20T00:00:00.000Z").map((event) => event.provider)).toEqual([
      "one",
      "two",
    ]);
    store.close();
  });
});
