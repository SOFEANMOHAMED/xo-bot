import type { Product } from '../../core/types.js';

export type HarnessLlmReply = {
  response_text: string;
  next_action?: string;
  customer_request?: {
    wants_alternatives?: boolean;
    asks_product_info?: boolean;
    wants_photo?: boolean;
    ready_to_confirm?: boolean;
    wants_add_another?: boolean;
  };
  extracted_info?: Record<string, unknown>;
};

export type PipelineHarness = {
  catalog: Product[];
  llmReply: HarnessLlmReply;
  calls: {
    generateJSON: number;
    searchProducts: number;
  };
  lastGeneratePrompt: string | null;
};

const DEFAULT_REPLY: HarnessLlmReply = {
  response_text: 'كيف يمكنني مساعدتك؟',
  next_action: 'discover_needs',
  customer_request: {
    wants_alternatives: false,
    asks_product_info: false,
    wants_photo: false,
    ready_to_confirm: false,
    wants_add_another: false,
  },
  extracted_info: {},
};

export const harness: PipelineHarness = {
  catalog: [],
  llmReply: structuredClone(DEFAULT_REPLY),
  calls: {
    generateJSON: 0,
    searchProducts: 0,
  },
  lastGeneratePrompt: null,
};

export function resetHarness(): void {
  harness.catalog = [];
  harness.llmReply = structuredClone(DEFAULT_REPLY);
  harness.calls.generateJSON = 0;
  harness.calls.searchProducts = 0;
  harness.lastGeneratePrompt = null;
}

export function setCatalog(products: readonly Product[]): void {
  harness.catalog = products.map((product) => structuredClone(product));
}

export function setLlmReply(reply: HarnessLlmReply): void {
  harness.llmReply = structuredClone(reply);
}
