# Feature Specification: Department Thought Level for an Assistant

**Feature Branch**: `nex-work`
**Created**: 2026-10-23
**Status**: Implemented; verified live on the dev Mac (local cynapse)

## Why

The purchase requisition review assistant cross-checks a requisition against six K3 reports. It
was tested at `max` reasoning effort, but employees cannot choose that: the department locks model
choices (`model.userSelectable = false`), which hides the thought-level selector (spec 014 FR-5).

Without a pin, the guide page falls back in two steps:

1. It uses the assistant's `auto` default, which is the employee's last choice.
2. With no last choice, it uses the runtime option's `currentValue`, which bundled Claude Code
   reports as `null`, and then the first option.

Claude Code's options are `low / medium / high / xhigh / max / ultracode`. So a new employee's
conversations start on `low`.

## Requirements

- **FR-1** cynapse serves `assistants[].thought_level` (`low`…`max`) for a Claude Code assistant
  whose department entry pins it. Contract: cynapse
  `doc/spec/2026-09-09-managed-nexwork-agents.md` §19.
- **FR-2** The managed install writes it as the assistant's default thought level,
  `{ mode: 'fixed', value }`, and writes `{ mode: 'auto' }` when it is absent, so a dropped pin does
  not survive a reinstall. The guide page already starts new conversations on a fixed default
  (`resolveGuidAssistantDefaults`, `GuidPage`) and sends it as `conversation_overrides.thought_level`.
- **FR-3** Only the managed install applies it. That is the path Electron desktops take
  (`applyDeptConfig` hands off to `connectManagedAgents`), and the purchase assistant is a catalog
  assistant. The department-config service, used outside Electron, leaves thought levels alone.

Old clients ignore the field and keep the behaviour described above.

## Acceptance criteria

- [x] The managed install fixes `max` on the assistant that pins it and resets an earlier pin to
      `auto` on one that does not (`managedClaudeSelection.test.ts`). The test fails with the write
      removed.
- [x] Fixed defaults resolve to their value on the guide page (existing `assistantDefaults.test.ts`).
- [x] Live (NexWork-Dev, local cynapse with `thought_level: max` on purchase-req-review,
      2026-10-23): `defaults.thought_level` is `fixed max` on purchase-req-review and `auto` on the
      default and office assistants.
