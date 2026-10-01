/**
 * PostgreSQL pool.
 *
 * NODE_ENV=test:
 *   - loads backend/.env.test only (never backend/.env)
 *   - refuses DB_NAME=xobot_db and any name that does not end with `_test`
 *   - does not open a socket until the first query
 * Production / development: existing dotenv.config() + eager pool.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import {
  NODE_ENV_TEST,
  assertTestDatabaseAllowed,
  normalizeDatabaseName,
} from './testDatabasePolicy.js';

const { Pool } = pg;

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadEnv(): void {
  if (process.env.NODE_ENV === NODE_ENV_TEST) {
    dotenv.config({ path: path.join(backendRoot, '.env.test') });
    return;
  }
  dotenv.config();
}

loadEnv();
assertTestDatabaseAllowed(process.env.NODE_ENV, process.env.DB_NAME);

function buildPoolConfig(): pg.PoolConfig {
  assertTestDatabaseAllowed(process.env.NODE_ENV, process.env.DB_NAME);
  const isTest = process.env.NODE_ENV === NODE_ENV_TEST;
  const database = isTest
    ? normalizeDatabaseName(process.env.DB_NAME)
    : process.env.DB_NAME || 'xobot_db';
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    // Under load, 2s connect timeout caused cascade failures (WhatsApp + admin stats).
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
}

function attachPoolLogging(pool: pg.Pool): pg.Pool {
  pool.on('connect', () => {
    logger.info('Database connected successfully');
    console.log('✅ Database connected');
  });
  pool.on('error', (err) => {
    logger.error('Database connection error', err);
    console.error('❌ Database connection error:', err);
  });
  return pool;
}

function createPool(): pg.Pool {
  return attachPoolLogging(new Pool(buildPoolConfig()));
}

function createLazyTestPool(): pg.Pool {
  let real: pg.Pool | undefined;
  const getPool = (): pg.Pool => {
    assertTestDatabaseAllowed(process.env.NODE_ENV, process.env.DB_NAME);
    if (!real) {
      real = createPool();
    }
    return real;
  };
  return new Proxy({} as pg.Pool, {
    get(_target, prop) {
      if (prop === 'then') {
        return undefined;
      }
      const target = getPool();
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value === 'function') {
        return (value as (...args: never[]) => unknown).bind(target);
      }
      return value;
    },
  });
}

const pool: pg.Pool =
  process.env.NODE_ENV === NODE_ENV_TEST ? createLazyTestPool() : createPool();

export { UnsafeTestDatabaseError, assertTestDatabaseAllowed } from './testDatabasePolicy.js';
export default pool;
