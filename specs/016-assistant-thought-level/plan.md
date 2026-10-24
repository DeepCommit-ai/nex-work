# Plan: Department Thought Level for an Assistant

## Approach

- `AssistantSpec.thought_level` is the wire field. cynapse validates the value and the engine, so
  the client trusts it.
- `installCatalog` writes `defaults.thought_level` next to `defaults.model`, using the same rule:
  the server is the source of truth, so a missing pin writes `auto` rather than keeping the old
  value.
- No renderer change. The guide page already applies a fixed thought-level default when the runtime
  offers that value.

## Files

| File                                                                  | Owner | Change            |
| --------------------------------------------------------------------- | ----- | ----------------- |
| `packages/desktop/src/common/deptconfig/types.ts`                     | ours  | +5                |
| `packages/desktop/src/process/services/managedagents/install.ts`      | ours  | +2                |
| `tests/unit/deptconfig/managedClaudeSelection.test.ts`                | ours  | +31 −1            |
| `specs/016-assistant-thought-level/{spec,plan}.md`, `specs/README.md` | ours  | new, +1 index row |

## Upstream drift

None: every touched file is an enterprise addition.

## Verification

- `bunx vitest run tests/unit/deptconfig` and the full suite.
- Live check on NexWork-Dev against the local cynapse; see spec.md.
