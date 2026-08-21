/**
 * The first eight terms mirror pi-ai's NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN
 * (dist/utils/retry.js:4-19), the maintained hard-limit shapes these providers
 * return. `exhausted` covers OpenRouter's daily-cap wording, `credit` covers
 * Vercel credit exhaustion, and 402/403 cover payment-required plus the stable
 * tier-block and region-block responses observed from Vercel and OpenCode Zen.
 * Bare 429/rate-limit/too-many-requests wording stays out because OpenRouter's
 * 20-requests-per-minute throttle is not a daily cap. Bare `exceeded` stays out
 * because maximum-context errors are not quota exhaustion. pi-ai exposes no
 * failed-response status event, so the message is the only signal here.
 */
const LIMIT_ERROR_PATTERN = /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing|exhausted|credit|\b402\b|\b403\b/i;

export type FailureKind = "limit" | "error";

export function classifyFailure(errorMessage: string | undefined): FailureKind {
  return LIMIT_ERROR_PATTERN.test(errorMessage ?? "") ? "limit" : "error";
}

/** Provider daily quotas reset at UTC midnight, so cooldowns end there. */
export function cooldownUntil(nowMs: number): string {
  const now = new Date(nowMs);
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();
}
