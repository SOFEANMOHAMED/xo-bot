# Phase 5 — resolveOrderNextAction guard inventory

Read-only audit. **No simplification in this remediation** — wait for explicit go-ahead
(I4 / confirm_order risk). Source: `orderConfirmationPolicy.ts` `resolveOrderNextAction`
(~lines 616–854) + `docs/CHANGELOG_BRAIN.md`.

## Guard order (first match wins)

| # | Condition | Result | Why it exists (changelog) |
| --- | --- | --- | --- |
| 1 | `isBrowseTurnIntent` (browse_media / product_qa) | Force send_image / present_product; strip premature checkout copy | HOTFIX 2E / TurnIntent — browse must not collect |
| 2 | `asksProductInfo` (model flag or heuristic), excluding identity-answer turns and upsell bot replies | present_product + strip false order-placed claims | S10: LLM sets asks_product_info on address / identity answers |
| 3 | `customerCancelsOrder` && effectivelyComplete | end_conversation + cancel template | Explicit whole-order cancel |
| 4 | Complete + botAskedConfirm + declinesMore + !botAskedAddMore + !affirms | await + ambiguous-no clarification | Bare «لا» at confirm ask |
| 5 | `resolveConfirmFinalize` → finalize | confirm_order | I4 single gate (also used by index fast-path) |
| 6 | !effectivelyComplete + mayReplaceWithOrderTemplate + (collect/triedCheckout/leaked) | collect_info + identity templates | Deterministic identity collect (2D) |
| 7 | !effectivelyComplete otherwise | pass through AI next_action | Browse/price without hijack |
| 8 | turnIntent === cart_edit && complete | present_product pass-through | Add-another / cart edit must not await |
| 9 | justBecameComplete \|\| modelTriedUpsell \|\| checkout-ish AI action \|\| affirms | await_confirmation summary | S10: last identity field / upsell hijack |
| 10 | else complete non-order | pass through | Already-complete catalog Q&A |

## Related gates outside this function

- `resolveConfirmFinalize` — shared I4 facts for index fast-path + this function.
- `applyPostAgentReplyPolicy` — variant ask beats await; await template once; identity SSOT.
- `mayReplaceWithOrderTemplate` — browse/product_qa cannot be replaced by order templates.
- Soft-affirm standalone (`طيب` alone vs `طيب في تلفزيونات`) — I4 soft affirm catalog hotfix.

## Existing tests that pin these guards

- `test-i4-soft-affirm-catalog`
- `test-verification-matrix` (M08* await / finalize)
- `test-browse-not-collect`
- `test-collect-info-order`
- `test-p0-cart-integrity` (S10-related hard cases)
- `test-turn-intent-golden` / `test-customer-request-golden`

## Simplification candidates (not applied)

Only after go-ahead and with matching tests:

1. Merge “justBecameComplete” and “modelTriedUpsell” await branches if coverage proves identical outcomes.
2. Collapse duplicate identity-template builders (`buildCollectMissingFieldsMessage` vs `resolveIdentityCollectReply`) — already mostly delegated.
3. Revisit soft-affirm token lists if dialect coverage expands via interpreter whitelist instead.
