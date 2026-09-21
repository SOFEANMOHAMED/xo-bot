/**
 * Rules for NODE_ENV=test database access.
 * Pure functions — no dotenv, no pg, no process.exit.
 */

export const NODE_ENV_TEST = 'test';
export const PRODUCTION_DATABASE_NAME = 'xobot_db';
export const TEST_DATABASE_SUFFIX = '_test';

export function normalizeDatabaseName(raw: string | undefined): string {
  return (raw ?? '').trim();
}

export function isProductionDatabaseName(name: string): boolean {
  return name === PRODUCTION_DATABASE_NAME;
}

export function isAllowedTestDatabaseName(name: string): boolean {
  if (!name || isProductionDatabaseName(name)) {
    return false;
  }
  return name.endsWith(TEST_DATABASE_SUFFIX);
}

export class UnsafeTestDatabaseError extends Error {
  readonly dbName: string;

  constructor(dbName: string) {
    const shown = dbName || '(empty)';
    super(
      `Refusing to start under NODE_ENV=test: DB_NAME=${JSON.stringify(shown)} is not a _test database`,
    );
    this.name = 'UnsafeTestDatabaseError';
    this.dbName = dbName;
  }
}

/** Throws when NODE_ENV=test and DB_NAME is missing, is xobot_db, or does not end with _test. */
export function assertTestDatabaseAllowed(
  nodeEnv: string | undefined,
  dbNameRaw: string | undefined,
): void {
  if (nodeEnv !== NODE_ENV_TEST) {
    return;
  }
  const dbName = normalizeDatabaseName(dbNameRaw);
  if (isAllowedTestDatabaseName(dbName)) {
    return;
  }
  throw new UnsafeTestDatabaseError(dbName);
}

/**
 * Preflight message before any test module loads connection.ts.
 * Does not require a _test suffix — .env.test is loaded later by the guard.
 */
export function preflightFatalMessage(
  nodeEnv: string | undefined,
  dbNameRaw: string | undefined,
): string | null {
  if (nodeEnv !== NODE_ENV_TEST) {
    return 'FATAL: test runner requires NODE_ENV=test (refusing to run).';
  }
  if (normalizeDatabaseName(dbNameRaw) === PRODUCTION_DATABASE_NAME) {
    return 'FATAL: refusing to run tests against DB_NAME=xobot_db.';
  }
  return null;
}
