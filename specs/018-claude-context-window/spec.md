# Feature Specification: Department Default Claude Code Context Window

**Feature Branch**: `nex-work`
**Created**: 2026-10-26
**Status**: Implemented; unit-tested. Live check pending.

## Why

Department `advance` runs its Claude Code assistants on Kimi `k3.1-pro` (cynapse
`doc/spec/2026-10-26-kimi-code接入-design.md`). The department wants a 256K window for its ordinary
Claude Code assistants. The purchase requisition review assistant keeps 1M through its opus slot
`k3.1-pro[1m]` (spec 014, cynapse §18).

Spec 014 cannot express this. It has two windows: 200k, which Claude Code gives any model name it
does not recognise, and 1M through the `[1m]` marker on a slot. A third window has to come from
Claude Code's own environment.

Bundled Claude Code 2.1.235 (`package.json` `claudeCodeVersion`) sizes a model's window as follows.
The rules were read from its binary; cynapse §22 records them with the measurements:

1. A `[1m]` suffix gives 1,000,000.
2. Otherwise, for a model name that does not start with `claude-`, it uses
   `CLAUDE_CODE_MAX_CONTEXT_TOKENS` when that is set.
3. Otherwise the window is 200,000.

Auto-compact follows the model window.

- With `CLAUDE_CODE_MAX_CONTEXT_TOKENS=262144` (measured 2026-10-26), `modelUsage.contextWindow` is
  262144 for `k3.1-pro` and still 1000000 for `k3.1-pro[1m]`.
- `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is the wrong variable. Claude Code compacts at
  min(model window, that value) for every session, `[1m]` ones included, so it would cap the
  purchase assistant's 1M sessions at 256K as well.

The variable belongs to the Claude Code agent's `env_override`, which every session on this machine
shares (spec 014). That makes the window a property of the department, not of one assistant.

## Requirements

- **FR-1** cynapse serves `gateway.claude_context_tokens`. It is an integer, today only `262144`,
  or `null`/absent: Claude Code's default window on this machine for gateway models. Contract:
  cynapse `doc/spec/2026-09-09-managed-nexwork-agents.md`, the new section on the 256k default
  window (§22 in the cynapse change). Nothing else in the `/config` shape changes.
- **FR-2** Both apply paths (managed catalog install and the department-config service) write it to
  the Claude Code agent's `env_override` as `CLAUDE_CODE_MAX_CONTEXT_TOKENS=<n>`. They do this only
  in the branch that manages Claude models (`claudeModel !== undefined`), next to spec 012's model
  variables and spec 014's slots.
- **FR-3** The department config manages the variable. A `null` or missing field removes it, so a
  department that goes back to 200k actually returns to 200k. It follows the same rules as the
  other managed Claude variables:
  - a manual save on the gateway settings page computes no department fields and keeps it;
  - other CLI agents (the department-config service passes them no Claude fields) keep whatever they
    have.
- **FR-4** The client never writes `CLAUDE_CODE_AUTO_COMPACT_WINDOW`.
- **FR-5** `validateConfig` rejects a `claude_context_tokens` that is not `null`/absent and not an
  integer from 1 to 1,048,576 (strings, fractions, 0, negatives, booleans, objects). A bad value
  stops the apply before anything is written, like a bad `claude_slots`.

## Behaviour by client and server version

- **Old clients** (before this spec) ignore the field. They do not manage the variable, so Claude
  Code stays at 200k for `k3.1-pro` and the `[1m]` slot stays at 1M. Nothing errors.
- **Old servers** do not send the field. This client then removes the variable. That is a no-op
  unless something wrote it before.
- **Downgrade** from this client to an old one leaves the last written value in place, because the
  old client treats the variable as an unrelated entry. A department that drops 256k after such a
  downgrade must upgrade the client again, or the variable must be removed by hand.
- A running managed client applies the config again only when the server's ETag changes. cynapse
  includes `context_window` in the ETag fingerprint (cynapse §22), so a change to the department's
  window reaches running clients.
- Expected but not measured: the variable takes effect for Claude Code processes started after the
  write, because the environment is read at spawn. Sessions that are already running keep their
  window.

## Acceptance criteria

- [x] `buildEnvOverride` (`tests/unit/gateway/provisionGateway.test.ts`):
  - it writes `CLAUDE_CODE_MAX_CONTEXT_TOKENS=262144` and keeps the `[1m]` opus slot as it is;
  - it replaces an earlier value without duplicating it;
  - it removes the value on `null` and on `undefined`, also when the department pins no model;
  - it keeps the value when `claudeModel` is `undefined` (manual save, non-Claude runtime) and
    writes nothing new in that case;
  - it skips values Claude Code cannot use;
  - it never writes `CLAUDE_CODE_AUTO_COMPACT_WINDOW`.
- [x] The managed install writes the window, then removes it when the department drops it. It never
      writes `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and keeps unrelated entries (`provisioning.test.ts`).
- [x] The department-config service writes the window to Claude Code only. A value someone set on
      another CLI agent stays as it is, and a dropped window is removed from Claude Code. An
      unusable value fails the apply with nothing written (`deptConfigServiceGateway.test.ts`).
- [x] `validateConfig` accepts 262144, 1, 1048576, `null` and absent. It rejects `"262144"`, 0, -1,
      1.5, 1048577, `true` and `{}` (`applyConfig.test.ts`).
- [x] Each new test fails with the corresponding code reverted: the managed set ignoring
      `claudeModel`, either pass-through removed, or the validation removed.
- [ ] Live (NexWork-Dev against a cynapse that serves `claude_context_tokens: 262144`):
  - the Claude Code agent env has `CLAUDE_CODE_MAX_CONTEXT_TOKENS=262144`;
  - a default-assistant session reports `contextWindow` 262144;
  - a purchase session reports 1000000;
  - after the server drops the field, the variable is gone and new sessions report 200000.
- [ ] Production: after the cynapse deploy and the `advance` change to 256k, a default-assistant
      session on the new client reports 262144 (cynapse §22 acceptance).
