import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ChainEntry } from "./config.js";
import { classifyFailure, cooldownUntil } from "./classify.js";
import { nextEligible } from "./router.js";
import type { RouterEvent, RouterStore } from "./store.js";

export type PiModel = Parameters<ExtensionAPI["setModel"]>[0];

type NotifyType = "info" | "warning" | "error";

export interface ControllerDeps {
  resolveModel(entry: ChainEntry): PiModel | undefined;
  setModel(model: PiModel): Promise<boolean>;
  currentModel(): { provider: string; id: string } | undefined;
  sendContinue(): void;
  notify(message: string, type: NotifyType): void;
  /** Applied after a switch when the chain entry names a level. */
  setThinking(level: NonNullable<ChainEntry["thinking"]>): void;
  /** Footer status text; undefined clears the entry. */
  setStatus(text: string | undefined): void;
  store: RouterStore | undefined;
  now(): number;
}

/** The continuation is a visible user message because pi exposes no seamless retry API. */
export const RESUME_MESSAGE = "Continue.";

export class RouterController {
  private readonly chain: ChainEntry[];
  private readonly deps: ControllerDeps;
  private readonly attempted = new Set<string>();
  private readonly cooldowns: Map<string, string>;
  private lastError: { message: string } | undefined;
  /** Always loaded, engaged only on demand: /model-router arms, off disarms. */
  private activeFlag = false;

  constructor(chain: ChainEntry[], deps: ControllerDeps) {
    this.chain = chain;
    this.deps = deps;
    this.cooldowns = new Map(
      deps.store?.activeCooldowns(new Date(deps.now()).toISOString()),
    );
    this.refreshStatus();
  }

  get active(): boolean {
    return this.activeFlag;
  }

  noteAssistantMessage(stopReason: string | undefined, errorMessage: string | undefined): void {
    this.lastError = stopReason === "error"
      ? { message: errorMessage ?? "" }
      : undefined;
  }

  noteUserInput(source: string): void {
    if (source !== "extension") this.attempted.clear();
  }

  async onSettled(): Promise<void> {
    if (!this.activeFlag || !this.lastError) return;

    // Only route failures of chain members: an unrelated (e.g. paid) model
    // erroring must not dump the session onto the chain.
    const currentRaw = this.currentRaw();
    if (!currentRaw || !this.chain.some((entry) => entry.raw === currentRaw)) {
      this.lastError = undefined;
      return;
    }

    const message = this.lastError.message;
    const kind = classifyFailure(message);
    const current = this.deps.currentModel();
    if (current) {
      const nowMs = this.deps.now();
      const until = kind === "limit" ? cooldownUntil(nowMs) : undefined;
      const event: RouterEvent = {
        at: new Date(nowMs).toISOString(),
        provider: current.provider,
        model: current.id,
        kind,
        detail: message.slice(0, 500),
        cooldownUntil: until,
      };
      this.deps.store?.record(event);
      if (until) this.cooldowns.set(`${current.provider}/${current.id}`, until);
    }

    this.lastError = undefined;
    await this.advance(kind);
  }

  async activate(): Promise<boolean> {
    this.activeFlag = true;
    const currentRaw = this.currentRaw();
    if (currentRaw && this.isEligible(currentRaw)) {
      // Arming onto a chain entry honours its pinned level, same as switching to it.
      const entry = this.chain.find((candidate) => candidate.raw === currentRaw);
      if (entry?.thinking) this.deps.setThinking(entry.thinking);
      const suffix = entry?.thinking ? ` (${entry.thinking})` : "";
      this.deps.notify(`routing on, staying on ${currentRaw}${suffix}`, "info");
      this.refreshStatus();
      return true;
    }
    return this.advance("manual");
  }

  deactivate(): void {
    this.activeFlag = false;
    this.deps.notify("routing off", "info");
    this.refreshStatus();
  }

  refreshStatus(): void {
    if (!this.activeFlag) {
      this.deps.setStatus(undefined);
      return;
    }
    const currentRaw = this.currentRaw();
    const inChain =
      currentRaw !== undefined && this.chain.some((entry) => entry.raw === currentRaw);
    const cooling = this.coolingCount();
    const base = inChain ? currentRaw! : "armed";
    this.deps.setStatus(cooling > 0 ? `${base} (${cooling} cooling)` : base);
  }

  async advance(reason: "manual" | "limit" | "error"): Promise<boolean> {
    const failedRaw = this.currentRaw();
    if (failedRaw) this.attempted.add(failedRaw);

    for (;;) {
      const candidate = nextEligible(
        this.chain,
        this.attempted,
        this.cooldowns,
        this.deps.now(),
        this.currentRaw(),
      );
      if (!candidate) {
        this.deps.notify(
          `model-router chain exhausted (${this.attemptedCount()} attempted, ${this.coolingCount()} cooling)`,
          "error",
        );
        this.refreshStatus();
        return false;
      }

      this.attempted.add(candidate.raw);
      const model = this.deps.resolveModel(candidate);
      if (!model) {
        this.deps.notify(`not in pi's catalog: ${candidate.raw}`, "warning");
        continue;
      }

      let switched: boolean;
      try {
        switched = await this.deps.setModel(model);
      } catch (error) {
        const detail = errorMessage(error);
        this.deps.notify(`could not switch to ${candidate.raw}: ${detail}`, "error");
        this.recordSwitchFailure(candidate, detail);
        continue;
      }
      if (!switched) {
        const detail = "no credentials";
        this.deps.notify(`could not switch to ${candidate.raw}: ${detail}`, "error");
        this.recordSwitchFailure(candidate, detail);
        continue;
      }

      if (candidate.thinking) this.deps.setThinking(candidate.thinking);

      this.deps.store?.record({
        at: new Date(this.deps.now()).toISOString(),
        provider: candidate.provider,
        model: candidate.modelId,
        kind: "switch",
      });
      const left = this.chain.filter((entry) => !this.attempted.has(entry.raw)).length;
      const target = candidate.thinking ? `${candidate.raw} (${candidate.thinking})` : candidate.raw;
      this.deps.notify(
        `${failedRaw ?? "no current model"} ${reason}; switched to ${target} (${left} chain models left)`,
        "info",
      );
      if (reason !== "manual") this.deps.sendContinue();
      this.refreshStatus();
      return true;
    }
  }

  /** The chain as configured, in order, with any pinned thinking level. */
  configText(): string {
    if (this.chain.length === 0) return "chain is empty";
    const lines = this.chain.map((entry, i) => {
      const level = entry.thinking ? `  [thinking: ${entry.thinking}]` : "";
      return `${i + 1}. ${entry.raw}${level}`;
    });
    return [`${this.chain.length} models in the chain, best first:`, ...lines].join("\n");
  }

  statusText(): string {
    const nowMs = this.deps.now();
    const currentRaw = this.currentRaw();
    const counts = new Map<string, number>();
    const store = this.deps.store;
    if (store) {
      const midnight = new Date(nowMs);
      const sinceIso = new Date(Date.UTC(
        midnight.getUTCFullYear(),
        midnight.getUTCMonth(),
        midnight.getUTCDate(),
      )).toISOString();
      for (const event of store.recentEvents(sinceIso)) {
        if (event.kind !== "limit") continue;
        const raw = `${event.provider}/${event.model}`;
        counts.set(raw, (counts.get(raw) ?? 0) + 1);
      }
    }

    const lines = this.chain.map((entry) => {
      let marker = "-";
      if (entry.raw === currentRaw) {
        marker = ">";
      } else {
        const until = this.cooldowns.get(entry.raw);
        if (until && Date.parse(until) > nowMs) marker = `x cooling until ${until}`;
      }
      const count = counts.get(entry.raw) ?? 0;
      return `${marker} ${entry.raw} (${count} limits today)`;
    });
    if (!store) lines.unshift("history off");
    return lines.join("\n");
  }

  private currentRaw(): string | undefined {
    const current = this.deps.currentModel();
    return current ? `${current.provider}/${current.id}` : undefined;
  }

  private isEligible(raw: string): boolean {
    const entry = this.chain.find((candidate) => candidate.raw === raw);
    if (!entry || this.attempted.has(raw)) return false;
    const until = this.cooldowns.get(entry.raw);
    return until === undefined || Date.parse(until) <= this.deps.now();
  }

  private recordSwitchFailure(entry: ChainEntry, detail: string): void {
    this.deps.store?.record({
      at: new Date(this.deps.now()).toISOString(),
      provider: entry.provider,
      model: entry.modelId,
      kind: "error",
      detail,
    });
  }

  private attemptedCount(): number {
    return this.chain.filter((entry) => this.attempted.has(entry.raw)).length;
  }

  private coolingCount(): number {
    const nowMs = this.deps.now();
    return this.chain.filter((entry) => {
      const until = this.cooldowns.get(entry.raw);
      return until !== undefined && Date.parse(until) > nowMs;
    }).length;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
