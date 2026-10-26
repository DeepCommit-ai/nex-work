# Plan: Department Default Claude Code Context Window

## Approach

- **Wire field (FR-1).** `GatewaySection.claude_context_tokens: number | null`. The comment on
  `AssistantSpec.context_window` now lists `256k`, which cynapse serves for the record; the client
  does not act on it.
- **One writer (FR-2, FR-3).** `GATEWAY_ENV_CLAUDE_CONTEXT_TOKENS` joins the variables
  `buildEnvOverride` manages when `claudeModel !== undefined`, and `GatewayConfig.claudeContextTokens`
  carries the value. That branch writes `String(n)` for a positive integer and nothing otherwise.
  The variable is in the managed set, so an absent value removes it.
  - When `claudeModel` is `undefined` (gateway settings page, non-Claude agents in the
    department-config service), the variable is not managed and is preserved like any unrelated
    entry. This is spec 014's rule for slots.
  - `env_override` stays a single store with one writer (specs 006, 012).
- **Pass-through.** The managed install passes `gateway.claude_context_tokens ?? null`. The
  department-config service passes it for the Claude Code agent only (`undefined` elsewhere), as it
  does for `claude_model` and `claude_slots`.
- **Not AUTO_COMPACT (FR-4).** Nothing writes `CLAUDE_CODE_AUTO_COMPACT_WINDOW`. Its rationale sits
  in the comment on the constant, so a later change does not reach for it.
- **Validation (FR-5).** `validateConfig` checks for an integer from 1 to
  `CLAUDE_CONTEXT_TOKENS_MAX` (1,048,576), next to the `claude_model` check. The message follows the
  existing Chinese problem strings in that function. Those strings are apply-failure details, not
  i18n UI text.
- **No aioncore or renderer UI change.** aioncore hands `env_override` to the spawned Claude Code,
  which does the rest.

## Files

| File                                                                | Owner | Change            |
| ------------------------------------------------------------------- | ----- | ----------------- |
| `packages/desktop/src/common/gateway/types.ts`                      | ours  | +22               |
| `packages/desktop/src/common/gateway/provisionGateway.ts`           | ours  | +7 −1             |
| `packages/desktop/src/common/deptconfig/types.ts`                   | ours  | +8 −1             |
| `packages/desktop/src/common/deptconfig/applyConfig.ts`             | ours  | +17 −1            |
| `packages/desktop/src/process/services/managedagents/install.ts`    | ours  | +2                |
| `packages/desktop/src/renderer/services/deptConfigService.ts`       | ours  | +2                |
| `tests/unit/gateway/provisionGateway.test.ts`                       | ours  | +47               |
| `tests/unit/gateway/deptConfigServiceGateway.test.ts`               | ours  | new               |
| `tests/unit/deptconfig/{applyConfig,provisioning}.test.ts`          | ours  | +40               |
| `specs/018-claude-context-window/{spec,plan}.md`, `specs/README.md` | ours  | new, +1 index row |

The new department-config service test goes in `tests/unit/gateway/`. `tests/unit/deptconfig/` is
already at the 10-child limit, and `tests/unit/gateway/` had a single file.

## Upstream drift

None: every touched file is an enterprise addition. All of them are absent from `upstream/main`.

## Verification

- Focused vitest: `tests/unit/gateway` and `tests/unit/deptconfig`, 11 files and 182 tests passed.
  Each new test was checked against reverted source: the managed set ignoring `claudeModel`, either
  pass-through removed, or the validation removed.
- Full vitest suite on Linux: 564 files passed and 5 skipped; 5677 tests passed and 20 skipped.
- `tsc --noEmit` is clean, and the touched test files also typecheck under an ad-hoc config. oxlint
  on the touched files reports 0 errors and no new warnings. oxfmt check passes. `i18n:types` and
  `check-i18n` pass; their warnings existed before.
- Live check on NexWork-Dev is pending; see spec.md.
