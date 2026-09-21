/**
 * Run typecheck first, then every package.json test-* script except this one.
 * NODE_ENV=test is forced. Children already have preflight (except the guard).
 *
 * FAIL → exit 1. SKIPPED / KNOWN_PENDING are never counted as passed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countKnownPendingLines,
  countSkippedLines,
  isKnownPendingSuite,
} from './testSkip.js';

const TYPECHECK_LABEL = 'typecheck';
const TEST_ALL_SCRIPT = 'test-all';
const SUITE_TIMEOUT_MS = 60_000;
const TYPECHECK_TIMEOUT_MS = 120_000;

type SuiteVerdict = 'PASS' | 'FAIL' | 'SKIPPED' | 'KNOWN_PENDING';

type PackageJson = {
  scripts?: Record<string, string>;
};

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadSuiteNames(): string[] {
  const pkg = JSON.parse(readFileSync(path.join(backendRoot, 'package.json'), 'utf8')) as PackageJson;
  return Object.keys(pkg.scripts || {})
    .filter((name) => name.startsWith('test-') && name !== TEST_ALL_SCRIPT)
    .sort();
}

function runNpm(script: string, timeoutMs: number): { status: number; output: string } {
  const result = spawnSync('npm', ['run', script], {
    cwd: backendRoot,
    env: { ...process.env, NODE_ENV: 'test' },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutMs,
  });
  const timedOut =
    result.signal === 'SIGTERM' ||
    result.signal === 'SIGKILL' ||
    result.error?.message.includes('ETIME') === true ||
    result.status === null;
  const timeoutNote = timedOut ? `\nFAIL ${script} exceeded ${timeoutMs}ms\n` : '';
  return {
    status: timedOut ? 1 : (result.status ?? 1),
    output: `${result.stdout || ''}${result.stderr || ''}${timeoutNote}`,
  };
}

function classifySuite(name: string, status: number, output: string): SuiteVerdict {
  const skipCount = countSkippedLines(output);
  const pendingLines = countKnownPendingLines(output);
  if (status === 0 && skipCount > 0) {
    return 'SKIPPED';
  }
  if (status === 0 && pendingLines > 0) {
    return 'KNOWN_PENDING';
  }
  if (status === 0) {
    return 'PASS';
  }
  if (isKnownPendingSuite(name)) {
    return 'KNOWN_PENDING';
  }
  return 'FAIL';
}

const suiteNames = loadSuiteNames();
if (suiteNames.length === 0) {
  console.error('No test-* scripts found in package.json');
  process.exit(1);
}

let passed = 0;
let failed = 0;
let skipped = 0;
let knownPending = 0;
const rows: string[] = [];

console.log(`===== ${TYPECHECK_LABEL} =====`);
const typecheck = runNpm(TYPECHECK_LABEL, TYPECHECK_TIMEOUT_MS);
process.stdout.write(typecheck.output.endsWith('\n') ? typecheck.output : `${typecheck.output}\n`);
const typecheckVerdict: SuiteVerdict = typecheck.status === 0 ? 'PASS' : 'FAIL';
if (typecheckVerdict === 'PASS') {
  passed += 1;
} else {
  failed += 1;
}
rows.push(`${typecheckVerdict}\t${TYPECHECK_LABEL}\texit=${typecheck.status}`);
console.log(rows[rows.length - 1]);

for (const name of suiteNames) {
  console.log(`===== ${name} =====`);
  const result = runNpm(name, SUITE_TIMEOUT_MS);
  process.stdout.write(result.output.endsWith('\n') ? result.output : `${result.output}\n`);
  const verdict = classifySuite(name, result.status, result.output);
  if (verdict === 'PASS') {
    passed += 1;
  } else if (verdict === 'SKIPPED') {
    skipped += 1;
  } else if (verdict === 'KNOWN_PENDING') {
    knownPending += 1;
  } else {
    failed += 1;
  }
  const line = `${verdict}\t${name}\texit=${result.status}`;
  rows.push(line);
  console.log(line);
}

const total = 1 + suiteNames.length;
console.log('\n===== SUMMARY =====');
for (const row of rows) {
  console.log(row);
}
console.log(
  `Suites: ${passed} passed, ${failed} failed, ${skipped} skipped, ${knownPending} known_pending (of ${total}; skipped/pending never counted as passed)`,
);
process.exit(failed > 0 ? 1 : 0);
