/**
 * Hard cap + token/cost accounting for live LLM measurement runs.
 * Keys are never logged.
 */
export type LiveBudgetSnapshot = {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  estimatedUsd: number;
  aborted: boolean;
  abortReason: string | null;
};

/** gpt-4o-mini ballpark — estimate only, not billing. */
const USD_PER_1K_PROMPT = 0.00015;
const USD_PER_1K_COMPLETION = 0.0006;

/** Enough for §6+extras ×3 runs (~60 turns ×3); abort hard at cap. */
const DEFAULT_MAX_CALLS = 250;

export class LiveLlmBudget {
  readonly maxCalls: number;
  private calls = 0;
  private promptTokens = 0;
  private completionTokens = 0;
  private aborted = false;
  private abortReason: string | null = null;

  constructor(maxCalls = DEFAULT_MAX_CALLS) {
    this.maxCalls = maxCalls;
  }

  remaining(): number {
    return Math.max(0, this.maxCalls - this.calls);
  }

  /** Throws when the hard cap is reached. */
  beforeCall(): void {
    if (this.calls >= this.maxCalls) {
      this.aborted = true;
      this.abortReason = `LLM call cap reached (${this.maxCalls})`;
      throw new Error(this.abortReason);
    }
  }

  afterCall(usage?: { prompt_tokens?: number; completion_tokens?: number }): void {
    this.calls += 1;
    this.promptTokens += usage?.prompt_tokens || 0;
    this.completionTokens += usage?.completion_tokens || 0;
  }

  snapshot(): LiveBudgetSnapshot {
    const estimatedUsd =
      (this.promptTokens / 1000) * USD_PER_1K_PROMPT +
      (this.completionTokens / 1000) * USD_PER_1K_COMPLETION;
    return {
      calls: this.calls,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      estimatedUsd: Number(estimatedUsd.toFixed(6)),
      aborted: this.aborted,
      abortReason: this.abortReason,
    };
  }

  formatSummary(): string {
    const s = this.snapshot();
    return (
      `LLM budget: calls=${s.calls}/${this.maxCalls}` +
      ` promptTok=${s.promptTokens} completionTok=${s.completionTokens}` +
      ` estUsd≈${s.estimatedUsd}` +
      (s.aborted ? ` ABORTED: ${s.abortReason}` : '')
    );
  }
}

/** Process-wide budget used by the live LLM bridge. */
export const liveBudget = new LiveLlmBudget(
  Number(process.env.LIVE_LLM_MAX_CALLS || DEFAULT_MAX_CALLS) || DEFAULT_MAX_CALLS
);
