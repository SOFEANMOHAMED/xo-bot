import { AsyncLocalStorage } from 'node:async_hooks';
import type { LlmUsageContextStore } from './types.js';

const llmUsageAls = new AsyncLocalStorage<LlmUsageContextStore>();

export function runWithLlmUsageContext<T>(
  store: LlmUsageContextStore,
  fn: () => Promise<T>
): Promise<T> {
  return llmUsageAls.run(store, fn);
}

export function getLlmUsageContext(): LlmUsageContextStore | undefined {
  return llmUsageAls.getStore();
}
