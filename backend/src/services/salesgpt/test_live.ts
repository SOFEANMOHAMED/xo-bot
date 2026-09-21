/**
 * PHASE 1B — live LLM measurement entrypoint.
 *
 *   LIVE_LLM=1 npm run test-live
 *   LIVE_LLM=1 npm run test-live -- --gate
 *   LIVE_LLM=1 LIVE_LLM_MAX_CALLS=300 npm run test-live -- --full-paraphrases
 *
 * Not part of test-all. No production behavior changes. Keys never printed.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { liveBudget } from './liveEval/liveBudget.js';
import {
  evaluateGate,
  formatBaselineMarkdown,
  formatReportArabic,
  runLiveMeasurement,
  type Thresholds,
} from './liveEval/liveRunner.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const repoRoot = path.resolve(backendRoot, '..');
const thresholdsPath = path.join(backendRoot, 'test-live.thresholds.json');
const baselinePath = path.join(repoRoot, 'docs/BASELINE.md');

function parseArgs(argv: string[]): {
  gate: boolean;
  fullParaphrases: boolean;
  writeBaseline: boolean;
  runs: number;
} {
  const gate = argv.includes('--gate');
  const fullParaphrases = argv.includes('--full-paraphrases');
  const writeBaseline = !argv.includes('--no-write-baseline');
  const runsIdx = argv.indexOf('--runs');
  const runs =
    runsIdx >= 0 && argv[runsIdx + 1]
      ? Math.max(1, Number(argv[runsIdx + 1]) || 3)
      : 3;
  return { gate, fullParaphrases, writeBaseline, runs };
}

function resolveCommitHash(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function loadThresholds(): Thresholds {
  if (!existsSync(thresholdsPath)) {
    return {
      overall: 0.5,
      byInvariant: { I1: 0.9, I2: 0.95, I3: 0.9, I4: 0.99, I5: 0.95 },
    };
  }
  return JSON.parse(readFileSync(thresholdsPath, 'utf8')) as Thresholds;
}

function writeThresholdsFromReport(
  report: Awaited<ReturnType<typeof runLiveMeasurement>>['report']
): void {
  // Baseline thresholds: slightly below measured rates (floor), never above 0.99 overall.
  const floor = (r: number, slack = 0.05): number =>
    Number(Math.max(0, Math.min(0.99, r - slack)).toFixed(2));

  const thresholds: Thresholds = {
    overall: floor(report.overall.rate, 0.1),
    byTurnType: Object.fromEntries(
      Object.entries(report.byTurnType).map(([k, v]) => [k, floor(v.rate, 0.1)])
    ),
    byInvariant: {
      I1: floor(report.byInvariant.I1.rate, 0.05),
      I2: floor(report.byInvariant.I2.rate, 0.02),
      I3: floor(report.byInvariant.I3.rate, 0.05),
      I4: floor(report.byInvariant.I4.rate, 0.01),
      I5: floor(report.byInvariant.I5.rate, 0.05),
    },
  };
  writeFileSync(thresholdsPath, `${JSON.stringify(thresholds, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  if (process.env.LIVE_LLM !== '1') {
    console.error('FAIL test-live: set LIVE_LLM=1 to run live measurement (opt-in).');
    process.exit(2);
  }
  if (process.env.NODE_ENV !== 'test') {
    console.error('FAIL test-live: NODE_ENV must be test.');
    process.exit(2);
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error('FAIL test-live: OPENAI_API_KEY missing after liveEnv preload.');
    process.exit(2);
  }

  const args = parseArgs(process.argv.slice(2));
  const commitHash = resolveCommitHash();
  console.log(`test-live start commit=${commitHash.slice(0, 12)} maxCalls=${liveBudget.maxCalls}`);

  const { report } = await runLiveMeasurement({
    runs: args.runs,
    fullParaphrases: args.fullParaphrases,
    commitHash,
    onProgress: (msg) => console.log(`  … ${msg}`),
  });

  console.log(formatReportArabic(report));

  if (args.writeBaseline) {
    writeFileSync(baselinePath, `${formatBaselineMarkdown(report)}\n`, 'utf8');
    console.log(`wrote ${baselinePath}`);
    if (!args.gate) {
      writeThresholdsFromReport(report);
      console.log(`wrote ${thresholdsPath}`);
    }
  }

  if (args.gate) {
    const thresholds = loadThresholds();
    const gate = evaluateGate(report, thresholds);
    if (!gate.ok) {
      console.error('GATE FAIL:');
      for (const v of gate.violations) console.error(`  - ${v}`);
      process.exit(1);
    }
    console.log('GATE PASS');
  }

  // Measurement exit: non-zero only on budget abort without any results, or gate fail.
  if (report.overall.total === 0) {
    console.error('FAIL test-live: no scenario runs completed');
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`FAIL test-live: ${maskSafe(msg)}`);
  process.exit(1);
});

function maskSafe(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-***')
    .replace(/OPENAI_API_KEY\s*=\s*\S+/gi, 'OPENAI_API_KEY=***');
}
