# Plan: One Claude Code Assistant on Its Own Model and Window; Locked Selectors Stay Hidden

## Approach

- **Slots (FR-1, FR-2).** `CLAUDE_SLOT_ENV` maps `opus / sonnet / haiku` to their variables, and
  `GatewayConfig.claudeSlots` carries the served map.
  - `buildEnvOverride` writes each of the four names from its slot when the map has one, else from
    `claudeModel`. So an absent map restores spec 012's behaviour.
  - Slots are only read when `claudeModel !== undefined`, which means a manual save on the gateway
    page keeps both.
- **Selection (FR-3).** `pinnedModel(spec)` in `applyConfig.ts` returns `claude_selection` or
  `fixed_model`. `planWrites`, the department-config service (create and enrich) and the managed
  install all call it, so they cannot disagree about which value aioncore must keep.
- **Validation (FR-4).** `CLAUDE_CODE_MODEL_IDS` is the cached catalog. `gatewayModelOf` removes a
  trailing `[1m]` before the alias check, because the marker belongs to Claude Code, not the gateway.
- **No aioncore change.** aioncore already applies a catalog selection in-band (`set_model`). The
  slot variable then decides the real model and window.
- **Selector leak (FR-5).** The three `sheetEntries` memos read `useCapability('model.userSelectable')`
  and filter the two keys when it is off. The desktop selectors already use the same capability
  through their own components. Each file carries `[ENTERPRISE PATCH] spec 014` markers.

## Files

| File                                                                                       | Owner    | Change            |
| ------------------------------------------------------------------------------------------ | -------- | ----------------- |
| `packages/desktop/src/common/gateway/types.ts`                                             | ours     | +25               |
| `packages/desktop/src/common/gateway/provisionGateway.ts`                                  | ours     | +16 −2            |
| `packages/desktop/src/common/deptconfig/types.ts`                                          | ours     | +17               |
| `packages/desktop/src/common/deptconfig/applyConfig.ts`                                    | ours     | +30 −2            |
| `packages/desktop/src/process/services/managedagents/install.ts`                           | ours     | +5 −1             |
| `packages/desktop/src/renderer/services/deptConfigService.ts`                              | ours     | +6 −2             |
| `packages/desktop/src/renderer/pages/guid/components/GuidActionRow.tsx`                    | upstream | +7 −1             |
| `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx`            | upstream | +7 −1             |
| `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx`      | upstream | +7 −1             |
| `tests/unit/gateway/provisionGateway.test.ts`, `tests/unit/deptconfig/applyConfig.test.ts` | ours     | +79 −1            |
| `tests/unit/deptconfig/managedClaudeSelection.test.ts`                                     | ours     | new               |
| `tests/unit/renderer/GuidActionRow.dom.test.tsx`                                           | upstream | +51 −1            |
| `tests/unit/renderer/conversation/{AcpSendBox,AionrsSendBox}.dom.test.tsx`                 | upstream | +113 −5           |
| `specs/014-assistant-model-window/{spec,plan}.md`, `specs/README.md`                       | ours     | new, +1 index row |

## Upstream drift

- The three send-box / action-row files each gain one import, one capability read and a filtered
  return (plus the memo dependency). Upstream has no capability policy, so this is not a sync-back
  candidate. On a conflict, keep upstream's entry list and reapply the filter on its return.
- The three upstream DOM test files gain a hoisted capability mock and one `describe` block each.

## Verification

- Focused vitest: `tests/unit/gateway`, `tests/unit/deptconfig` (including the new install test)
  and the three DOM tests. Each new DOM test was mutation-checked against the reverted source.
- `tsc --noEmit` clean.
- Live check on NexWork-Dev against the local cynapse; see spec.md.
