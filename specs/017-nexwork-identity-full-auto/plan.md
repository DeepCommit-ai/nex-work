# Plan: NexWork Self-Identity and Full-Auto Managed Conversations

## Approach

- Identity is a prompt problem the server owns: the common rule is published from nex-agents and
  reaches every client, including old ones. The client only mirrors it in the offline default.
- Hiding Claude Code's bundled skills uses its own setting (`disableBundledSkills`) in the profile
  NexWork already writes, not a replacement system prompt. aioncore deliberately uses
  `--append-system-prompt`: `--system-prompt` would drop the harness guidance.
- Permission rides the existing assistant default (`defaults.permission`) that the guide page
  already resolves. `MANAGED_PERMISSION` maps each catalog engine to its full-auto mode id, which
  is the same id the managed integration probes already send.

## Files

| File                                                                          | Owner | Change            |
| ----------------------------------------------------------------------------- | ----- | ----------------- |
| `packages/desktop/src/common/deptconfig/catalog.ts`                           | ours  | +5                |
| `packages/desktop/src/process/services/managedagents/install.ts`              | ours  | +3 −1             |
| `packages/desktop/src/branding/assistants/{claudeProfile,runtime,prompts}.ts` | ours  | small edits       |
| `packages/desktop/src/branding/assistants/README.md`                          | ours  | +3 −1             |
| `tests/unit/branding/assistants/*.test.ts`, `tests/unit/deptconfig/...`       | ours  | new cases         |
| `specs/017-nexwork-identity-full-auto/{spec,plan}.md`, `specs/README.md`      | ours  | new, +1 index row |

## Upstream drift

None: every touched file is an enterprise addition.

## Verification

- Focused unit tests and the full suite.
- Request capture and model answers with the bundled Claude Code; live check on NexWork-Dev
  against the local cynapse. See spec.md.
