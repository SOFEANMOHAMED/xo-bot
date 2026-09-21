/**
 * Abort before any test file loads a DB driver against production.
 * Loaded via: tsx --import ./src/database/testPreflight.ts
 *
 * Does not read backend/.env. Does not connect.
 */
import { preflightFatalMessage } from './testDatabasePolicy.js';

const fatal = preflightFatalMessage(process.env.NODE_ENV, process.env.DB_NAME);
if (fatal) {
  console.error(fatal);
  process.exit(1);
}
