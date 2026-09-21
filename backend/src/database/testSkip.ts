/**
 * Explicit skip / known-pending contract for NODE_ENV=test suites.
 *
 * A suite that is allowed to skip MUST print a `SKIPPED:` line (via skipSuite).
 * Silent exit 0 is a pass, not a skip.
 *
 * KNOWN_PENDING is an explicit allow-list in the runner
 * and/or a `KNOWN_PENDING:` stdout line. It is never counted as passed.
 */
export const SKIPPED_LINE_PREFIX = 'SKIPPED:';
export const KNOWN_PENDING_LINE_PREFIX = 'KNOWN_PENDING:';

/** Reconstructed regressions whose target production slices are not restored yet. */
export const KNOWN_PENDING_SUITES: readonly string[] = Object.freeze([
  'test-p0-cart-integrity',
  'test-commerce-engine',
  'test-verification-matrix-pending',
]);

export function skipSuite(reason: string): never {
  const text = reason.trim() || 'unspecified reason';
  console.log(`${SKIPPED_LINE_PREFIX} ${text}`);
  process.exit(0);
}

export function markKnownPending(reason: string): never {
  const text = reason.trim() || 'unspecified reason';
  console.log(`${KNOWN_PENDING_LINE_PREFIX} ${text}`);
  process.exit(0);
}

export function countPrefixedLines(output: string, prefix: string): number {
  if (!output) {
    return 0;
  }
  let n = 0;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith(prefix)) {
      n += 1;
    }
  }
  return n;
}

export function countSkippedLines(output: string): number {
  return countPrefixedLines(output, SKIPPED_LINE_PREFIX);
}

export function countKnownPendingLines(output: string): number {
  return countPrefixedLines(output, KNOWN_PENDING_LINE_PREFIX);
}

export function isKnownPendingSuite(name: string): boolean {
  return KNOWN_PENDING_SUITES.includes(name);
}
