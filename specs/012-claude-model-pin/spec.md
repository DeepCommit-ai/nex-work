# Feature Specification: Department Model for Claude Code Assistants

**Feature Branch**: `nex-work`
**Created**: 2026-10-19
**Status**: Implemented; verified live on the dev Mac

## Why

Departments pin assistants to a gateway alias (`fixed_model`, issue #6), and NexWork records the
pin on each new conversation. For assistants on the Claude Code engine the pin never reached
the model. aioncore only accepts models from Claude Code's own catalog (`default`, `opus[1m]`,
`sonnet`, `sonnet[1m]`, `haiku`) and drops `glm-5.3-flash` with the warning "persisted model
selection is absent from the agent's catalog". The session then starts on Claude's default name
(`claude-opus-5`).

Through the gateway this went unnoticed: LiteLLM's wildcard route maps any name to
`glm-5.3-flash`. Connected directly to the upstream (2026-10-19 debugging), the purchase
requisition review assistant ran on whatever the upstream maps `claude-opus-5` to. The aion
engine (Butler) is not affected; it reads the aliases from its provider row.

## Requirements

- **FR-1** cynapse serves `gateway.claude_model`: the model pinned by the department's Claude
  Code assistants in the served view, or `null`. It rejects a department whose Claude Code
  assistants pin different models. Contract: cynapse
  `doc/spec/2026-09-09-managed-nexwork-agents.md` §17.
- **FR-2** Both apply paths (managed catalog install and the department-config service) write it to
  the Claude Code agent's `env_override` as `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`,
  `ANTHROPIC_DEFAULT_SONNET_MODEL` and `ANTHROPIC_DEFAULT_HAIKU_MODEL`. Claude Code then uses it for
  the session, the model picker's aliases and background tasks.
- **FR-3** `null` or a missing field clears those variables: the server is the source of truth. A
  manual save on the gateway settings page keeps them.
- **FR-4** Validation rejects a `claude_model` that is not in `model_aliases`, as it rejects a bad
  assistant pin: the gateway would answer 404 to every request.

## Acceptance criteria

- [x] `buildEnvOverride` sets all four names, replaces an earlier value, clears on `null` and keeps
      on a manual save (unit tests).
- [x] The managed install writes `ANTHROPIC_MODEL` from `gateway.claude_model` (unit test).
- [x] `validateConfig` rejects a `claude_model` outside the aliases (unit test).
- [x] Bundled Claude Code honours `ANTHROPIC_MODEL=glm-5.3-flash` against the upstream:
      `modelUsage` reports `glm-5.3-flash`; without it, `claude-opus-5[1m]`.
- [x] Live (NexWork-Dev, direct upstream, 2026-10-19): a new purchase review conversation's
      process has `ANTHROPIC_MODEL=glm-5.3-flash`; its transcript and aioncore's `running_model` both
      report `glm-5.3-flash`.
