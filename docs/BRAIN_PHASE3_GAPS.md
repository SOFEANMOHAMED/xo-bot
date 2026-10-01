# Phase 3 — Coverage gaps: old rails vs interpreter

Documented before retiring duplicate early rails in `processWithSalesGPT`.
Identifiers in English; explanation in Arabic.

## Summary

| Action type | Old rail (index.ts) | Interpreter | Gap before retirement | Resolution |
| --- | --- | --- | --- | --- |
| `cancel_order` | INTERIM whole_cancel → cancelled template + early return | whitelist `matchCancel` + early return when applied | Nearly equivalent | Keep interpreter early return; delete INTERIM whole_cancel |
| `remove_line` | partial_remove → line_not_found / cart_empty / cart_remove templates + early return | whitelist `remove_line` (1 match) or `ask_clarification` (0/many); **no early return** → agent drafts reply | Reply templates missing when `remove_line` applied; ask_clarification does not skip old rail so 0/many still hit old templates | Add interpreter early return for remove_line (+ empty cart); then delete INTERIM partial_remove. Map ask_clarification after cancel-intent to line_not_found / ask-which via early rail owned by replyPolicy |
| `select_color` / `select_size` | pending + variant correction early returns with priced summary | whitelist pending + apply (Phase 2 creates cart line); skip old rails; **agent drafts reply** | No deterministic pending_select template after interpreter apply | Early return with `buildPendingSelectMessage` when select_* applied; then delete pending rail. Keep `resolveVariantChange` for negation / ask_which / unavailable not covered by bare pending whitelist |
| `correct_variant` | `resolveVariantChange` | LLM flip; intentionally does **not** skip old rail | Old rail remains needed for local negation («لا ما بدي اسود بدي احمر») | Keep `resolveVariantChange` rail; do not delete |
| `set_quantity` | Deterministic `resolveQuantity` / arabicQuantityWords on every turn | LLM flip only (no whitelist) | Reliability gap — LLM may miss dialect quantity | **Keep** deterministic quantity path; do not retire it |
| `request_photo` / `refuse_photo` / `ask_product_info` | `turnIntent` / `resolvePhotoDecision` heuristics | Flipped flags reinforce photo decision | Heuristics are SSOT for current-message photo; interpreter is optional reinforce | Keep turnIntent; do not delete |
| `add_product` | add-another / multi-cart sync rails | LLM flip `add_product` | Overlap with deterministic cart sync / add-another | Keep cart sync + add-another rails (message-structure owned); interpreter add is complementary |

## INTERPRETER_MODE

- Default: `flip` (`parseInterpreterMode` treats anything except `shadow` as flip).
- `shadow`: whitelist still applies; LLM actions are logged but not applied. Needed for safe rollback — **keep**.
- After Phase 3, `interpreterSkip` shrinks to only types that still share a dual path (`correct_variant` does not set skip; photo/quantity/product_info still gate extracts).

## Explicit non-retirements

1. Deterministic `resolveQuantity` (set_quantity reliability).
2. `resolveVariantChange` (negation / ask_which / unavailable).
3. Multi-product cart sync + add-another fast-paths.
4. Confirm fast-path (`resolveConfirmFinalize` / I4).
5. `turnIntent` photo / product_qa heuristics.

## Done in this remediation

- Whitelist `partial_remove` now emits one `remove_line` per matched cart line (same as old rail).
- Interpreter early returns: cancel / remove_line / cart_empty / line_not_found / pending select_*.
- Deleted INTERIM cancel/remove rail and pending color/size rail from `index.ts`.
- Kept `resolveVariantChange` rail + deterministic quantity + photo heuristics.
- Kept `INTERPRETER_MODE=shadow` for rollback (whitelist still applies live).
- `interpreterSkip` retained for: ask_product_info, select_color/size (gates variant correction), refuse/request_photo, set_quantity.
