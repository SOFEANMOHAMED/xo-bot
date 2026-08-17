import type { MerchantWaRuntime } from './types.js';

const runtimes = new Map<string, MerchantWaRuntime>();

export function getMerchantRuntime(merchantId: string): MerchantWaRuntime | undefined {
  return runtimes.get(merchantId);
}

export function setMerchantRuntime(runtime: MerchantWaRuntime): void {
  runtimes.set(runtime.merchantId, runtime);
}

export function deleteMerchantRuntime(merchantId: string): void {
  runtimes.delete(merchantId);
}

export function listMerchantRuntimes(): MerchantWaRuntime[] {
  return [...runtimes.values()];
}

export function rememberSentMessageId(merchantId: string, messageId: string | undefined): void {
  if (!messageId) return;
  const runtime = runtimes.get(merchantId);
  if (!runtime) return;
  runtime.sentMessageIds.add(messageId);
  if (runtime.sentMessageIds.size > 400) {
    const oldest = runtime.sentMessageIds.values().next().value;
    if (oldest) runtime.sentMessageIds.delete(oldest);
  }
}

export function wasSentByBot(merchantId: string, messageId: string | undefined): boolean {
  if (!messageId) return false;
  return runtimes.get(merchantId)?.sentMessageIds.has(messageId) === true;
}
