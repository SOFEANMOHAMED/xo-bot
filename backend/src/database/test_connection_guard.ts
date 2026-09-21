/**
 * Proves connection.ts throws under NODE_ENV=test + DB_NAME=xobot_db
 * before constructing pg.Pool (no socket).
 *
 * Run: npm run test-connection-guard
 * Do not attach testPreflight — preflight would exit(1) before this assertion.
 */
import {
  UnsafeTestDatabaseError,
  isAllowedTestDatabaseName,
  preflightFatalMessage,
} from './testDatabasePolicy.js';

process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'xobot_db';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_USER = 'nobody';
process.env.DB_PASSWORD = 'invalid';

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

assert(isAllowedTestDatabaseName('xobot_test') === true, 'xobot_test is allowed');
assert(isAllowedTestDatabaseName('xobot_db') === false, 'xobot_db is forbidden');
assert(isAllowedTestDatabaseName('postgres') === false, 'name without _test suffix is forbidden');
assert(isAllowedTestDatabaseName('') === false, 'empty name is forbidden');
assert(
  preflightFatalMessage('test', 'xobot_db') !== null,
  'preflight fatal when DB_NAME=xobot_db',
);
assert(
  preflightFatalMessage('production', 'xobot_test') !== null,
  'preflight fatal when NODE_ENV is not test',
);
assert(
  preflightFatalMessage('test', 'xobot_test') === null,
  'preflight allows NODE_ENV=test with a non-production name',
);

try {
  await import('./connection.js');
  assert(false, 'importing connection.ts must throw when NODE_ENV=test and DB_NAME=xobot_db');
} catch (error: unknown) {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message;
  assert(
    !message.includes('pg.Pool must not be constructed'),
    `must throw before Pool constructor, got: ${message}`,
  );
  assert(
    /xobot_db/.test(message) && /NODE_ENV=test/.test(message),
    `error must mention xobot_db and NODE_ENV=test, got: ${message}`,
  );
  assert(
    err.name === 'UnsafeTestDatabaseError' || /Refusing/.test(message),
    `expected UnsafeTestDatabaseError / Refusing, got name=${err.name} message=${message}`,
  );
  assert(
    error instanceof UnsafeTestDatabaseError,
    'thrown value is UnsafeTestDatabaseError',
  );
}

console.log(`Connection guard: ${passed}/${passed + failed} passed`);
if (failed) {
  process.exit(1);
}
console.log('✅ connection.ts refuses xobot_db under NODE_ENV=test before connecting');
