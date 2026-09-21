/**
 * Live measurement runner — multi-turn scenarios, invariants I1–I5, reply facts.
 * Pure aggregation + I/O separated: runScenarioTurn / aggregateReport are pure-ish.
 */
import type {
  CartItem,
  ConversationState,
  MerchantConfig,
  Message,
  Product,
} from '../../../core/types.js';
import type { SalesGPTPipelineResult } from '../index.js';
import { processWithSalesGPT } from '../index.js';
import { resetHarness, setCatalog } from '../test_pipeline_harness_state.js';
import { liveBudget } from './liveBudget.js';
import {
  classifyDecision,
  classifyRootCause,
  type DecisionClass,
  type FailureRootCause,
} from './liveClassify.js';
import { checkReplyFacts, maskTranscript } from './liveFacts.js';
import {
  cartSnapshot,
  checkInvariants,
  focusProductId,
  type InvariantId,
} from './liveInvariants.js';
import { paraphrase } from './liveParaphrases.js';
import {
  ALL_LIVE_SCENARIOS,
  resolveScenarioCatalog,
  type LiveScenario,
  type LiveTurnScript,
} from './liveScenarios.js';

export const DEFAULT_RUNS = 3;
export const PARAPHRASE_VARIANTS = 8;

const MERCHANT: MerchantConfig = {
  merchantId: '00000000-0000-4000-8000-000000000701',
  storeName: 'متجر قياس حي',
  storeCurrency: 'SAR',
  persona: 'friendly',
  botLanguage: 'arabic',
};

export type TurnType =
  | 'greeting'
  | 'browse'
  | 'price'
  | 'qa'
  | 'order'
  | 'color'
  | 'identity'
  | 'confirm'
  | 'cancel'
  | 'other';

export type LiveTurnRecord = {
  scenarioId: string;
  runIndex: number;
  turnIndex: number;
  turnType: TurnType;
  userMessage: string;
  replyText: string;
  intent: string;
  nextAction: string;
  decisionClass: DecisionClass;
  expectClass?: DecisionClass;
  cart: Array<{
    product_id: string;
    variant: string;
    qty: number;
    currency: string;
  }>;
  focusProductId: string | null;
  pendingQuestion: string | null;
  orderCreated: boolean;
  passed: boolean;
  invariantFailures: InvariantId[];
  factFailures: string[];
  stateFailures: string[];
  decisionUnexpected: boolean;
  rootCause: FailureRootCause | null;
};

export type LiveScenarioRunResult = {
  scenarioId: string;
  runIndex: number;
  paraphraseIndex: number;
  passed: boolean;
  turns: LiveTurnRecord[];
  aborted: boolean;
  abortReason: string | null;
};

export type RateBucket = { passed: number; total: number; rate: number };

export type LiveReport = {
  dateUtc: string;
  commitHash: string;
  runsPerScenario: number;
  scenarios: Array<{ id: string; title: string; rate: RateBucket }>;
  byTurnType: Record<string, RateBucket>;
  byInvariant: Record<InvariantId, RateBucket>;
  byRootCause: Record<FailureRootCause, number>;
  overall: RateBucket;
  budget: ReturnType<typeof liveBudget.snapshot>;
  failures: Array<{
    scenarioId: string;
    runIndex: number;
    turnIndex: number;
    rootCause: FailureRootCause;
    transcript: string;
    details: string[];
  }>;
};

function emptyState(seedFocus?: string | null): ConversationState {
  return {
    message_count: 0,
    last_recommended_products: seedFocus ? [seedFocus] : [],
    extracted_entities: seedFocus ? { product_id: seedFocus } : {},
  };
}

function classifyTurnType(turn: LiveTurnScript, userText: string): TurnType {
  if (turn.explicitConfirm) return 'confirm';
  if (turn.explicitRemoveOrCancel) return 'cancel';
  if (turn.expectPriceProductId) return 'price';
  if (turn.paraphraseKey === 'greeting') return 'greeting';
  if (turn.paraphraseKey === 'browse_all') return 'browse';
  if (turn.paraphraseKey === 'color_black' || /^ال?أسود$|^اسود$|^أحمر$|^احمر$/i.test(userText.trim())) {
    return 'color';
  }
  if (turn.expectClass === 'order') return 'order';
  if (turn.expectClass === 'qa') return 'qa';
  if (turn.expectClass === 'browse') return 'browse';
  if (turn.expectClass === 'photo') return 'browse';
  if (/اسم|هاتف|عنوان|\d{7,}/.test(userText)) return 'identity';
  return 'other';
}

function cartLines(items: CartItem[]): LiveTurnRecord['cart'] {
  return items.map((line) => ({
    product_id: line.productId,
    variant: [line.color, line.size].filter(Boolean).join('/') || '',
    qty: line.quantity,
    currency: line.currency,
  }));
}

function resolveTurnText(
  scenario: LiveScenario,
  turnIndex: number,
  turn: LiveTurnScript,
  paraphraseIndex: number
): string {
  const isKey = scenario.keyParaphraseTurns?.includes(turnIndex);
  if (isKey && turn.paraphraseKey) {
    return paraphrase(turn.paraphraseKey, paraphraseIndex, turn.text);
  }
  return turn.text;
}

async function callPipeline(input: {
  message: string;
  state: ConversationState;
  recent: Message[];
  catalog: readonly Product[];
}): Promise<SalesGPTPipelineResult> {
  // Keep catalog; do not wipe LLM budget. Reset call counters only.
  harnessSafeReset(input.catalog);
  return processWithSalesGPT({
    merchantId: MERCHANT.merchantId,
    messageText: input.message,
    recentMessages: input.recent,
    conversationState: input.state,
    merchantConfig: MERCHANT,
    platform: 'playground',
  });
}

function harnessSafeReset(catalog: readonly Product[]): void {
  // Preserve catalog between turns: resetHarness clears it — re-seed immediately.
  resetHarness();
  setCatalog(catalog);
}

function rate(passed: number, total: number): RateBucket {
  return {
    passed,
    total,
    rate: total === 0 ? 0 : Number((passed / total).toFixed(4)),
  };
}

export async function runScenarioOnce(input: {
  scenario: LiveScenario;
  runIndex: number;
  paraphraseIndex: number;
}): Promise<LiveScenarioRunResult> {
  const catalog = resolveScenarioCatalog(input.scenario);
  let state = emptyState(input.scenario.seedFocusProductId || null);
  const recent: Message[] = [];
  const turns: LiveTurnRecord[] = [];
  let aborted = false;
  let abortReason: string | null = null;
  let scenarioPassed = true;

  for (let turnIndex = 0; turnIndex < input.scenario.turns.length; turnIndex++) {
    const script = input.scenario.turns[turnIndex];
    const userMessage = resolveTurnText(
      input.scenario,
      turnIndex,
      script,
      input.paraphraseIndex
    );
    const beforeCart = cartSnapshot(state);
    const turnType = classifyTurnType(script, userMessage);

    let result: SalesGPTPipelineResult;
    try {
      result = await callPipeline({
        message: userMessage,
        state,
        recent,
        catalog,
      });
    } catch (error) {
      aborted = true;
      abortReason = error instanceof Error ? error.message : String(error);
      scenarioPassed = false;
      break;
    }

    const afterCart = cartSnapshot(result.updatedState);
    const beforeFocus = focusProductId(state);
    const afterFocus = focusProductId(result.updatedState);
    const beforeEntities = state.extracted_entities || {};
    const afterEntities = result.updatedState.extracted_entities || {};
    const decisionClass = classifyDecision({
      replyText: result.replyText,
      userMessage,
      beforeCart,
      afterCart,
      beforeColor: beforeEntities.color ?? null,
      afterColor: afterEntities.color ?? null,
      beforeSize: beforeEntities.size ?? null,
      afterSize: afterEntities.size ?? null,
      orderCreated: Boolean(result.updatedState.last_order),
      awaitingConfirmation: Boolean(result.updatedState.awaiting_order_confirmation),
      nextAction: result.next_action || '',
      intent: result.intent,
    });
    const orderCreated = Boolean(result.updatedState.last_order);
    const pendingQuestion = result.updatedState.pending_bot_question || null;

    const invariantFailures = checkInvariants({
      userMessage,
      replyText: result.replyText,
      nextAction: result.next_action || '',
      decisionClass,
      beforeCart,
      afterCart,
      userRemovedOrCancelled: script.explicitRemoveOrCancel === true,
      orderCreated,
      userExplicitlyConfirmed: script.explicitConfirm === true,
    });

    const customerTexts = [
      ...recent.filter((m) => m.role === 'user').map((m) => m.content),
      userMessage,
    ];
    const factFailures = checkReplyFacts({
      userMessage,
      replyText: result.replyText,
      catalog: [...catalog],
      cart: afterCart,
      focusProductId: afterFocus || beforeFocus,
      customerTexts,
      orderNumbers: result.updatedState.last_order
        ? [result.updatedState.last_order.orderId]
        : [],
      expectPriceForProductId: script.expectPriceProductId,
      expectOosProductId: script.expectOosProductId,
    });

    const stateFailures: string[] = [];
    // Soft state sanity: focus should exist after product-named turns when catalog matches.
    if (script.expectPriceProductId && afterFocus === null) {
      stateFailures.push('missing focus after price turn');
    }

    // Soft-fail only when observed EFFECT differs from expected effect.
    const decisionUnexpected =
      Boolean(script.expectClass) && script.expectClass !== decisionClass;

    const hardFail =
      invariantFailures.length > 0 ||
      factFailures.length > 0 ||
      stateFailures.length > 0;

    const rootCause = hardFail || decisionUnexpected
      ? classifyRootCause({
          invariantIds: invariantFailures.map((f) => f.id),
          factFailures: factFailures.map((f) => f.message),
          stateFailures,
          decisionUnexpected,
        })
      : null;

    const passed = !hardFail;
    if (!passed) scenarioPassed = false;

    turns.push({
      scenarioId: input.scenario.id,
      runIndex: input.runIndex,
      turnIndex,
      turnType,
      userMessage,
      replyText: result.replyText,
      intent: result.intent,
      nextAction: result.next_action || '',
      decisionClass,
      expectClass: script.expectClass,
      cart: cartLines(afterCart),
      focusProductId: afterFocus,
      pendingQuestion,
      orderCreated,
      passed,
      invariantFailures: invariantFailures.map((f) => f.id),
      factFailures: factFailures.map((f) => f.code),
      stateFailures,
      decisionUnexpected,
      rootCause,
    });

    recent.push({ role: 'user', content: userMessage });
    recent.push({ role: 'assistant', content: result.replyText });
    state = result.updatedState;
  }

  return {
    scenarioId: input.scenario.id,
    runIndex: input.runIndex,
    paraphraseIndex: input.paraphraseIndex,
    passed: scenarioPassed && !aborted,
    turns,
    aborted,
    abortReason,
  };
}

export type RunnerOptions = {
  runs?: number;
  /** When true, each key-turn scenario also expands all 8 paraphrases (budget heavy). */
  fullParaphrases?: boolean;
  scenarios?: readonly LiveScenario[];
  commitHash?: string;
  onProgress?: (msg: string) => void;
};

export async function runLiveMeasurement(
  options: RunnerOptions = {}
): Promise<{ report: LiveReport; results: LiveScenarioRunResult[] }> {
  const runs = options.runs ?? DEFAULT_RUNS;
  const scenarios = options.scenarios ?? ALL_LIVE_SCENARIOS;
  const results: LiveScenarioRunResult[] = [];

  /** Phase A: every scenario × N runs (paraphrase index = run). */
  outer: for (let runIndex = 0; runIndex < runs; runIndex++) {
    for (const scenario of scenarios) {
      if (liveBudget.remaining() <= 0) {
        options.onProgress?.(`abort: LLM call cap (${liveBudget.maxCalls})`);
        break outer;
      }
      const paraphraseIndex = runIndex % PARAPHRASE_VARIANTS;
      options.onProgress?.(
        `run ${runIndex + 1}/${runs} ${scenario.id} paraphrase=${paraphraseIndex}`
      );
      try {
        const result = await runScenarioOnce({
          scenario,
          runIndex,
          paraphraseIndex,
        });
        results.push(result);
        if (result.aborted) break outer;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        results.push({
          scenarioId: scenario.id,
          runIndex,
          paraphraseIndex,
          passed: false,
          turns: [],
          aborted: true,
          abortReason: reason,
        });
        if (/LLM call cap/.test(reason)) break outer;
      }
    }
  }

  /**
   * Phase B: expand remaining paraphrase indices (3..7, or all 0..7 with --full)
   * for scenarios that declare keyParaphraseTurns — until the hard call cap.
   */
  const expandFrom = options.fullParaphrases ? 0 : runs;
  if (expandFrom < PARAPHRASE_VARIANTS) {
    const keyScenarios = scenarios.filter((s) => (s.keyParaphraseTurns?.length || 0) > 0);
    expand: for (let paraphraseIndex = expandFrom; paraphraseIndex < PARAPHRASE_VARIANTS; paraphraseIndex++) {
      for (const scenario of keyScenarios) {
        if (liveBudget.remaining() <= 0) break expand;
        // Skip duplicates already covered in phase A for this paraphrase index.
        if (!options.fullParaphrases && paraphraseIndex < runs) continue;
        options.onProgress?.(
          `paraphrase-expand ${scenario.id} paraphrase=${paraphraseIndex}`
        );
        try {
          const result = await runScenarioOnce({
            scenario,
            runIndex: runs + paraphraseIndex,
            paraphraseIndex,
          });
          results.push(result);
          if (result.aborted) break expand;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          results.push({
            scenarioId: scenario.id,
            runIndex: runs + paraphraseIndex,
            paraphraseIndex,
            passed: false,
            turns: [],
            aborted: true,
            abortReason: reason,
          });
          if (/LLM call cap/.test(reason)) break expand;
        }
      }
    }
  }

  const report = buildReport({
    results,
    scenarios,
    runs,
    commitHash: options.commitHash || 'unknown',
  });
  return { report, results };
}

export function buildReport(input: {
  results: LiveScenarioRunResult[];
  scenarios: readonly LiveScenario[];
  runs: number;
  commitHash: string;
}): LiveReport {
  const byScenario = new Map<string, { passed: number; total: number; title: string }>();
  for (const s of input.scenarios) {
    byScenario.set(s.id, { passed: 0, total: 0, title: s.title });
  }
  const byTurnType: Record<string, { passed: number; total: number }> = {};
  const byInvariant: Record<InvariantId, { passed: number; total: number }> = {
    I1: { passed: 0, total: 0 },
    I2: { passed: 0, total: 0 },
    I3: { passed: 0, total: 0 },
    I4: { passed: 0, total: 0 },
    I5: { passed: 0, total: 0 },
  };
  const byRootCause: Record<FailureRootCause, number> = {
    keyword_classifier: 0,
    state_focus_drift: 0,
    llm_fact_violation: 0,
    template_override: 0,
  };
  const failures: LiveReport['failures'] = [];
  let overallPassed = 0;
  let overallTotal = 0;

  for (const result of input.results) {
    const bucket = byScenario.get(result.scenarioId);
    if (bucket) {
      bucket.total += 1;
      if (result.passed) bucket.passed += 1;
    }
    overallTotal += 1;
    if (result.passed) overallPassed += 1;

    for (const turn of result.turns) {
      const tt = byTurnType[turn.turnType] || { passed: 0, total: 0 };
      tt.total += 1;
      if (turn.passed) tt.passed += 1;
      byTurnType[turn.turnType] = tt;

      for (const id of Object.keys(byInvariant) as InvariantId[]) {
        byInvariant[id].total += 1;
        if (!turn.invariantFailures.includes(id)) {
          byInvariant[id].passed += 1;
        }
      }

      if (!turn.passed || turn.decisionUnexpected) {
        const cause = turn.rootCause || 'llm_fact_violation';
        byRootCause[cause] += 1;
        failures.push({
          scenarioId: turn.scenarioId,
          runIndex: turn.runIndex,
          turnIndex: turn.turnIndex,
          rootCause: cause,
          transcript: maskTranscript(
            `U: ${turn.userMessage}\nB: ${turn.replyText}`
          ),
          details: [
            ...turn.invariantFailures.map((id) => `invariant ${id}`),
            ...turn.factFailures,
            ...turn.stateFailures,
            turn.decisionUnexpected
              ? `decision expected=${turn.expectClass} got=${turn.decisionClass}`
              : '',
          ].filter(Boolean),
        });
      }
    }
  }

  const scenarios = [...byScenario.entries()].map(([id, v]) => ({
    id,
    title: v.title,
    rate: rate(v.passed, v.total),
  }));

  const byTurnTypeOut: Record<string, RateBucket> = {};
  for (const [k, v] of Object.entries(byTurnType)) {
    byTurnTypeOut[k] = rate(v.passed, v.total);
  }
  const byInvariantOut = {
    I1: rate(byInvariant.I1.passed, byInvariant.I1.total),
    I2: rate(byInvariant.I2.passed, byInvariant.I2.total),
    I3: rate(byInvariant.I3.passed, byInvariant.I3.total),
    I4: rate(byInvariant.I4.passed, byInvariant.I4.total),
    I5: rate(byInvariant.I5.passed, byInvariant.I5.total),
  };

  return {
    dateUtc: new Date().toISOString(),
    commitHash: input.commitHash,
    runsPerScenario: input.runs,
    scenarios,
    byTurnType: byTurnTypeOut,
    byInvariant: byInvariantOut,
    byRootCause,
    overall: rate(overallPassed, overallTotal),
    budget: liveBudget.snapshot(),
    failures,
  };
}

export type Thresholds = {
  overall: number;
  byTurnType?: Record<string, number>;
  byInvariant?: Partial<Record<InvariantId, number>>;
};

export function evaluateGate(
  report: LiveReport,
  thresholds: Thresholds
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  if (report.overall.rate < thresholds.overall) {
    violations.push(
      `overall ${report.overall.rate} < threshold ${thresholds.overall}`
    );
  }
  if (thresholds.byTurnType) {
    for (const [key, min] of Object.entries(thresholds.byTurnType)) {
      const bucket = report.byTurnType[key];
      if (!bucket || bucket.total === 0) continue;
      if (bucket.rate < min) {
        violations.push(`turnType ${key} ${bucket.rate} < ${min}`);
      }
    }
  }
  if (thresholds.byInvariant) {
    for (const [key, min] of Object.entries(thresholds.byInvariant)) {
      if (min === undefined) continue;
      const bucket = report.byInvariant[key as InvariantId];
      if (!bucket || bucket.total === 0) continue;
      if (bucket.rate < min) {
        violations.push(`invariant ${key} ${bucket.rate} < ${min}`);
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

export function formatReportArabic(report: LiveReport): string {
  const lines: string[] = [];
  lines.push('=== تقرير قياس النموذج الحي (test-live) ===');
  lines.push(`التاريخ UTC: ${report.dateUtc}`);
  lines.push(`الهاش: ${report.commitHash}`);
  lines.push(
    `الإجمالي: ${report.overall.passed}/${report.overall.total} (${(report.overall.rate * 100).toFixed(1)}%)`
  );
  lines.push(liveBudget.formatSummary());
  lines.push('');
  lines.push('— معدل النجاح لكل سيناريو —');
  for (const s of report.scenarios) {
    lines.push(
      `  ${s.id}: ${s.rate.passed}/${s.rate.total} (${(s.rate.rate * 100).toFixed(1)}%) — ${s.title}`
    );
  }
  lines.push('');
  lines.push('— حسب نوع الدور —');
  for (const [k, v] of Object.entries(report.byTurnType)) {
    lines.push(`  ${k}: ${(v.rate * 100).toFixed(1)}% (${v.passed}/${v.total})`);
  }
  lines.push('');
  lines.push('— الثوابت I1–I5 —');
  for (const id of ['I1', 'I2', 'I3', 'I4', 'I5'] as InvariantId[]) {
    const v = report.byInvariant[id];
    lines.push(`  ${id}: ${(v.rate * 100).toFixed(1)}% (${v.passed}/${v.total})`);
  }
  lines.push('');
  lines.push('— أسباب الجذر للفشل —');
  for (const [k, n] of Object.entries(report.byRootCause)) {
    lines.push(`  ${k}: ${n}`);
  }
  if (report.failures.length > 0) {
    lines.push('');
    lines.push(`— إخفاقات (${report.failures.length}) —`);
    for (const f of report.failures) {
      lines.push(
        `  [${f.rootCause}] ${f.scenarioId} r${f.runIndex} t${f.turnIndex}: ${f.details.join('; ')}`
      );
      lines.push(`    ${f.transcript.replace(/\n/g, ' | ')}`);
    }
  }
  return lines.join('\n');
}

export function formatBaselineMarkdown(report: LiveReport): string {
  const lines: string[] = [];
  lines.push('# BASELINE — live model measurement (PHASE 1C, valid scoring)');
  lines.push('');
  lines.push('Supersedes `docs/BASELINE_v1_INVALID.md` (contaminated harness scoring).');
  lines.push('');
  lines.push(`- **date (UTC):** ${report.dateUtc}`);
  lines.push(`- **commit:** \`${report.commitHash}\``);
  lines.push(`- **runs per scenario:** ${report.runsPerScenario}`);
  lines.push(
    `- **overall:** ${report.overall.passed}/${report.overall.total} (${(report.overall.rate * 100).toFixed(1)}%)`
  );
  lines.push(
    `- **LLM budget:** calls=${report.budget.calls} promptTok=${report.budget.promptTokens} completionTok=${report.budget.completionTokens} estUsd≈${report.budget.estimatedUsd}${report.budget.aborted ? ` ABORTED: ${report.budget.abortReason}` : ''}`
  );
  lines.push('');
  lines.push('## Per scenario');
  lines.push('');
  lines.push('| Scenario | Pass | Total | Rate | Title |');
  lines.push('| --- | ---: | ---: | ---: | --- |');
  for (const s of report.scenarios) {
    lines.push(
      `| ${s.id} | ${s.rate.passed} | ${s.rate.total} | ${(s.rate.rate * 100).toFixed(1)}% | ${s.title} |`
    );
  }
  lines.push('');
  lines.push('## Per turn type');
  lines.push('');
  lines.push('| Turn type | Pass | Total | Rate |');
  lines.push('| --- | ---: | ---: | ---: |');
  for (const [k, v] of Object.entries(report.byTurnType)) {
    lines.push(`| ${k} | ${v.passed} | ${v.total} | ${(v.rate * 100).toFixed(1)}% |`);
  }
  lines.push('');
  lines.push('## Per invariant');
  lines.push('');
  lines.push('| Invariant | Pass | Total | Rate |');
  lines.push('| --- | ---: | ---: | ---: |');
  for (const id of ['I1', 'I2', 'I3', 'I4', 'I5'] as InvariantId[]) {
    const v = report.byInvariant[id];
    lines.push(`| ${id} | ${v.passed} | ${v.total} | ${(v.rate * 100).toFixed(1)}% |`);
  }
  lines.push('');
  lines.push('## Failures by root cause');
  lines.push('');
  for (const [k, n] of Object.entries(report.byRootCause)) {
    lines.push(`- **${k}:** ${n}`);
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- Measurement only: catalog DB stubbed; real LLM via production client shape.');
  lines.push('- Keys never printed. Deploy requires `npm run test-live -- --gate` pass.');
  lines.push('- Paraphrase: key turns use dialect variants (×8 available); default matrix is scenario ×3 runs.');
  return lines.join('\n');
}
