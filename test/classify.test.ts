import { describe, expect, it } from "vitest";
import { classifyFailure, cooldownUntil } from "../src/classify.js";

describe("failure classification", () => {
  it("recognizes a provider hard limit", () => {
    expect(classifyFailure("429 FreeUsageLimitError: daily limit reached")).toBe("limit");
  });

  it("recognizes exhausted model wording without a status", () => {
    expect(classifyFailure("You've exhausted this model's rate limit")).toBe("limit");
  });

  it("does not cool a per-minute throttle", () => {
    expect(classifyFailure("429 Too Many Requests, retry in 20s")).toBe("error");
  });

  it("does not treat context length as quota exhaustion", () => {
    expect(classifyFailure("maximum context length exceeded")).toBe("error");
  });

  it("classifies an ordinary provider failure as error", () => {
    expect(classifyFailure("500 internal server error")).toBe("error");
    expect(classifyFailure(undefined)).toBe("error");
  });

  it("uses the following UTC midnight", () => {
    const nowMs = Date.parse("2026-08-20T15:42:11.000Z");
    expect(cooldownUntil(nowMs)).toBe("2026-08-21T00:00:00.000Z");
  });
});
