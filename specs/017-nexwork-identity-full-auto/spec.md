# Feature Specification: NexWork Self-Identity and Full-Auto Managed Conversations

**Feature Branch**: `nex-work`
**Created**: 2026-10-25
**Status**: Implemented; verified live on the dev Mac (local cynapse)

## Why

Asked "你是谁 / 你能做什么", the default assistant introduced itself as "an assistant in NexWork" and
then listed Claude Code's developer features: coding, Git, `/init`, `/security-review`, `/loop`,
`/claude-api`, keybindings and hooks. A capture of the bundled Claude Code 2.1.235 request shows
three causes:

1. Claude Code's system prompt starts with "You are Claude Code, Anthropic's official CLI for
   Claude". NexWork rules are appended with `--append-system-prompt` and cannot remove it.
2. The published common rule did not make NexWork the identity, and told the model to answer
   honestly about "the model or tools".
3. Claude Code's bundled skills appear in the skill list the model sees.

New conversations also started on the `default` permission mode, so employees confirmed every
command and file write. The user asked for full-auto by default (2026-10-25).

## Requirements

- **FR-1** The published common rule makes NexWork the identity (dedicated roles keep their own
  names). It treats the Claude Code wording as the internal engine and keeps self-introductions
  to office capabilities. It still answers honestly about the model named in the system prompt.
  Owner: nex-agents `catalog/common.md` (`8ae054c`). Contract: cynapse
  `doc/spec/2026-09-09-managed-nexwork-agents.md` §21.
- **FR-2** The NexWork Claude profile sets `disableBundledSkills: true` next to the output style,
  and repairs a profile an earlier release already styled. Workspace `.claude/skills/` are
  unaffected.
- **FR-3** The managed install writes each assistant's default permission as
  `{ mode: 'fixed', value }`. The value is the engine's full-auto mode: Claude Code
  `bypassPermissions`, Aion `yolo`. The offline default assistant is created with the same value.
  The guide page already applies a fixed permission default and sends it as
  `conversation_overrides.permission`. Employees can still switch it in the conversation.
- **FR-4** The offline default rules (`NEXWORK_BASE_RULES`) match FR-1.

Old clients get FR-1 once the catalog is published. FR-2 and FR-3 need this client.

## Acceptance criteria

- [x] Profile: other settings are preserved, and an earlier NexWork-styled profile gains
      `disableBundledSkills` (`assistantUpgrade.test.ts`).
- [x] Install: default, office and Butler get `bypassPermissions`, `bypassPermissions` and `yolo`.
      An employee's earlier stored permission is replaced (`managedClaudeSelection.test.ts`).
- [x] A missing default is recreated with `bypassPermissions` (`assistantProvisioning.test.ts`).
- [x] Request capture: with `disableBundledSkills`, a workspace skill is still listed and none of
      `security-review`, `simplify`, `claude-api`, `update-config`, `dataviz` are.
- [x] Live (NexWork-Dev, local cynapse catalog revision 26, 2026-10-25):
  - The four managed assistants store their permissions as above.
  - The guide page shows 全自动.
  - Sending "你是谁？你能做什么？" from the guide page spawns Claude Code with
    `--permission-mode bypassPermissions`, and the answer introduces NexWork and office
    capabilities.
  - A write-and-`cat` request completed both tool calls with no permission prompt.

## Not verified

- Answers through the production gateway.
- Windows.
- An Aion Butler conversation in `yolo`.
