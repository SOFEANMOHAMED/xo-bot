/**
 * Load ONLY LLM API key variables from backend/.env under NODE_ENV=test.
 * Never loads DB_* / DATABASE_* / PORT / host credentials.
 *
 * Must be imported before any module that reads OPENAI_API_KEY at load time.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_KEY_PREFIXES = ['OPENAI_', 'LLM_', 'GEMINI_'] as const;

const backendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
);

function isAllowedEnvKey(key: string): boolean {
  return ALLOWED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadLiveLlmEnvFromDotenv(): {
  loadedKeys: string[];
  hasApiKey: boolean;
} {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('liveEval env loader refuses to run outside NODE_ENV=test');
  }

  const envPath = path.join(backendRoot, '.env');
  const loadedKeys: string[] = [];
  if (!existsSync(envPath)) {
    return { loadedKeys, hasApiKey: Boolean(process.env.OPENAI_API_KEY) };
  }

  const parsed = parseEnvFile(readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (!isAllowedEnvKey(key)) continue;
    // Never overwrite an already-exported key (CI/local override wins).
    if (process.env[key]) continue;
    process.env[key] = value;
    loadedKeys.push(key);
  }

  return {
    loadedKeys,
    hasApiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
  };
}

// Side effect when imported as --import preload.
const boot = loadLiveLlmEnvFromDotenv();
if (!boot.hasApiKey && process.env.LIVE_LLM === '1') {
  console.error(
    'FAIL test-live: LIVE_LLM=1 but OPENAI_API_KEY is missing (load only LLM keys from backend/.env).'
  );
  process.exit(2);
}
