# Plan: Department Model for Claude Code Assistants

`env_override` already carries the gateway variables for Claude Code, written by `buildEnvOverride`
from both apply paths. The model joins them there, so there is still one writer of that store.

## Approach

- `GATEWAY_ENV_CLAUDE_MODELS` lists the four variable names; `GatewayConfig.claudeModel` is
  tri-state: `undefined` keeps them (manual gateway page), `null`/empty clears them, a value sets
  all four.
- `GatewaySection.claude_model` is the wire field. The managed install
  (`managedagents/install.ts`) passes `gateway.claude_model ?? null`. The department-config service
  passes it for the Claude Code agent only and leaves other CLI agents' variables alone.
- `validateConfig` adds the alias check next to the existing assistant-pin check.
- No aioncore change: with the conversation pin dropped, aioncore sends no model selection and
  Claude Code resolves its default from `ANTHROPIC_MODEL`.

## Files

| File                                                                                                      | Owner           | Change            |
| --------------------------------------------------------------------------------------------------------- | --------------- | ----------------- |
| `packages/desktop/src/common/gateway/types.ts`                                                            | ours (spec 006) | +25               |
| `packages/desktop/src/common/gateway/provisionGateway.ts`                                                 | ours (spec 006) | +4                |
| `packages/desktop/src/common/deptconfig/types.ts`                                                         | ours            | +5                |
| `packages/desktop/src/common/deptconfig/applyConfig.ts`                                                   | ours            | +7                |
| `packages/desktop/src/process/services/managedagents/install.ts`                                          | ours            | +2                |
| `packages/desktop/src/renderer/services/deptConfigService.ts`                                             | ours            | +2                |
| `tests/unit/gateway/provisionGateway.test.ts`, `tests/unit/deptconfig/{applyConfig,provisioning}.test.ts` | ours            | +56               |
| `specs/012-claude-model-pin/{spec,plan}.md`, `specs/README.md`                                            | ours            | new, +1 index row |

## Upstream drift

None: every touched file is an enterprise addition.

## Verification

- Focused vitest (`tests/unit/gateway`, `tests/unit/deptconfig`, `tests/unit/capabilities`): 162
  passed. `tsc --noEmit` clean; oxfmt on the touched files.
- Bundled Claude Code against the upstream with and without `ANTHROPIC_MODEL` (see spec.md).
