/**
 * NODE_ENV=test must not create or modify files in the production log dir.
 * This suite uses a temporary sandbox as a fake backend root — it never
 * snapshots or writes live backend/logs.
 *
 * Run: npm run test-logger-isolation
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  defaultTestLogDir,
  isProductionLogDir,
  productionLogDir,
  pruneOldLogs,
  resolveLoggerDir,
} from '../utils/logger.js';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAIL ${message}`);
}

assert(process.env.NODE_ENV === 'test', 'NODE_ENV must be test');

const liveProd = productionLogDir();
const liveResolved = resolveLoggerDir();
assert(
  path.resolve(liveResolved) !== path.resolve(liveProd),
  'live resolveLoggerDir() under test must not be backend/logs',
);
assert(
  liveResolved.replace(/\\/g, '/').includes('logs-test'),
  'live resolveLoggerDir() under test is logs-test',
);

const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xobot-logger-iso-'));
const fakeProd = path.join(sandboxRoot, 'logs');
const fakeTest = path.join(sandboxRoot, 'logs-test');
fs.mkdirSync(fakeProd, { recursive: true });
fs.mkdirSync(fakeTest, { recursive: true });

const oldProdFile = path.join(fakeProd, '2000-01-01.log');
const oldTestFile = path.join(fakeTest, '2000-01-01.log');
const prodMarker = `prod_prune_probe_${crypto.randomUUID()}`;
const testMarker = `test_prune_probe_${crypto.randomUUID()}`;
fs.writeFileSync(oldProdFile, prodMarker);
fs.writeFileSync(oldTestFile, testMarker);
const oldMtime = new Date('2000-01-02T00:00:00Z');
fs.utimesSync(oldProdFile, oldMtime, oldMtime);
fs.utimesSync(oldTestFile, oldMtime, oldMtime);

try {
  assert(isProductionLogDir(fakeProd, sandboxRoot), 'sandbox logs/ is production relative to fake root');
  assert(!isProductionLogDir(fakeTest, sandboxRoot), 'sandbox logs-test/ is not production');

  assert(
    resolveLoggerDir({ nodeEnv: 'test', backendRoot: sandboxRoot }) === defaultTestLogDir(sandboxRoot),
    'test default dir is logs-test under fake root',
  );
  assert(
    resolveLoggerDir({
      nodeEnv: 'test',
      logDir: fakeProd,
      backendRoot: sandboxRoot,
    }) === defaultTestLogDir(sandboxRoot),
    'LOG_DIR pointing at production logs/ is ignored under test',
  );
  const injected = path.join(sandboxRoot, 'injected-logs');
  assert(
    resolveLoggerDir({
      nodeEnv: 'test',
      logDir: injected,
      backendRoot: sandboxRoot,
    }) === path.resolve(injected),
    'non-production LOG_DIR is allowed under test',
  );

  pruneOldLogs(fakeProd, { backendRoot: sandboxRoot, nowMs: Date.now(), retentionDays: 1 });
  assert(fs.existsSync(oldProdFile), 'pruneOldLogs must not delete files in the production log dir');
  assert(fs.readFileSync(oldProdFile, 'utf8') === prodMarker, 'production sandbox file contents unchanged');

  pruneOldLogs(fakeTest, { backendRoot: sandboxRoot, nowMs: Date.now(), retentionDays: 1 });
  assert(!fs.existsSync(oldTestFile), 'pruneOldLogs may delete old daily files in logs-test');
} finally {
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
}

console.log(`Logger isolation: ${passed}/${passed + failed} passed`);
if (failed) {
  process.exit(1);
}
console.log('✅ test-mode logger does not create or modify backend/logs');
