/**
 * Structured classify call — separate from SalesGPTAgent.step.
 */
import { generateJSON } from '../../../ai/gemini-client.js';
import { logger } from '../../../utils/logger.js';
import { INTERPRETER_ACTION_TYPES, type InterpreterInput, type InterpreterResult } from './types.js';

type ModelPayload = {
  actions?: InterpreterResult['actions'];
  rawModelConfidence?: number;
};

function buildPrompt(input: InterpreterInput): string {
  const types = INTERPRETER_ACTION_TYPES.join(' | ');
  return `Classify the customer turn. Return JSON only.
Allowed action types: ${types}
allowedProductIds: ${JSON.stringify(input.allowedProductIds)}
cartLines: ${JSON.stringify(input.cartLines)}
state: ${JSON.stringify(input.stateSummary)}
recentMessages: ${JSON.stringify(input.recentMessages)}
message: ${JSON.stringify(input.message)}

Rules:
- Use only allowedProductIds and cart lineIds.
- color/size must be catalog labels from that line's allowedColors/allowedSizes.
- Each action needs evidence = a literal substring of message.
- Do not invent products, prices, or order ids.
- affirm_order is not confirm_order. cancel_order and affirm_order must not appear together.
- At most one ask_clarification.
- confidence 0..1.

{
  "actions": [{ "type": "...", "confidence": 0.9, "evidence": "...", "ambiguous": false }],
  "rawModelConfidence": 0.9
}`;
}

export async function interpretCustomerTurn(
  input: InterpreterInput
): Promise<InterpreterResult | null> {
  try {
    const generated = await generateJSON<ModelPayload>(buildPrompt(input), {
      temperature: 0,
      maxOutputTokens: 400,
      usage: { purpose: 'sales_chat' },
    });
    if (!generated.success || !generated.data) {
      logger.info('Interpreter LLM failed — caller falls back', {
        error: generated.error,
      });
      return null;
    }
    const actions = Array.isArray(generated.data.actions) ? generated.data.actions : [];
    const rawModelConfidence =
      typeof generated.data.rawModelConfidence === 'number'
        ? generated.data.rawModelConfidence
        : 0;
    return { actions, rawModelConfidence };
  } catch (error) {
    logger.error('Interpreter LLM threw', error as Error);
    return null;
  }
}
