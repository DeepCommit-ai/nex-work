# Feature Specification: One Claude Code Assistant on Its Own Model and Window; Locked Selectors Stay Hidden

**Feature Branch**: `nex-work`
**Created**: 2026-10-23
**Status**: Implemented; verified live on the dev Mac (local cynapse, direct upstream)

## Why

**Per-assistant model.** Departments run their Claude Code assistants on `glm-5.3-flash` (spec 012),
but the purchase requisition review assistant reads 100k–300k tokens of K3 reports. It needs
`glm-5.3` with a 1M context window, and only that assistant should pay for it.

Spec 012's mechanism cannot express this. Claude Code has one environment per agent (`2d23ff1c`,
agent-wide `env_override`), and aioncore adds only `AIONUI_*` per conversation. A conversation can
choose only a model from Claude Code's own catalog. Spec 012 listed that catalog as
`default / opus[1m] / sonnet / sonnet[1m] / haiku`. Once the slot variables are set, aioncore caches
only `default / opus / sonnet / haiku` (`agent_metadata.available_models`, measured 2026-10-23).
Pinning `opus[1m]` was dropped with "persisted model selection is absent from the agent's catalog"
and the session ran on `glm-5.3-flash`.

What works (bundled Claude Code 2.1.235, measured 2026-10-23):

- With `ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.3[1m]`, a session on `opus` reports
  `modelUsage {"glm-5.3[1m]": contextWindow 1000000}`.
- The gateway receives model `glm-5.3` (no suffix) plus the beta header `context-1m-2025-08-07`.
- A 337,386-token request on it returned normally from the upstream. The same request on plain
  `opus` (200k) was refused by Claude Code itself with "Prompt is too long".
- Sessions on `default` stay on `ANTHROPIC_MODEL` at 200k.

**Selector leak.** The department locks the model (`model.userSelectable = false`, spec 002), and
the desktop toolbars hide the model and thought-level selectors. Below 768px of window width, which
zooming in also produces (`Layout.tsx` `detectMobileViewportOrTouch`), "+" opens the
`MobileActionSheet` instead. Its entries listed `model` and `thought-level` without checking the
capability, so the locked choices reappeared.

## Requirements

- **FR-1** cynapse serves `gateway.claude_slots` (e.g. `{"opus": "glm-5.3[1m]"}`) and, per
  assistant, `claude_selection` (`"opus"` or `null`). They are set for a Claude Code assistant whose
  department entry has `context_window` (`1m` or `200k`). Contract: cynapse
  `doc/spec/2026-09-09-managed-nexwork-agents.md` §18.
- **FR-2** Both apply paths write each slot to its own variable (`opus` →
  `ANTHROPIC_DEFAULT_OPUS_MODEL`) in place of the department model, keeping the `[1m]` marker in the
  value. `ANTHROPIC_MODEL`, sonnet and haiku stay on `claude_model`. An empty slot map resets the
  slot to `claude_model`, as before.
- **FR-3** For an assistant with `claude_selection`, both paths pin the selection, not the gateway
  alias, as the assistant's default model. aioncore keeps it because it is in the catalog.
  `pinnedModel(spec)` is the single rule.
- **FR-4** `validateConfig` rejects:
  - a slot outside `opus / sonnet / haiku`;
  - a slot value whose alias, with the `[1m]` marker removed, is not in `model_aliases`;
  - a `claude_selection` outside the cached catalog `default / opus / sonnet / haiku`, including
    `opus[1m]`.
- **FR-5** The mobile action sheet on the guide page, the ACP send box and the Aionrs send box drops
  its `model` and `thought-level` entries when `model.userSelectable` is off. Other entries are
  unchanged.

Old clients (≤ `v2.1.61-nexwork.3`) ignore both new fields. They keep writing `claude_model` to all
four variables, and aioncore drops the gateway alias pinned on the conversation. So the
`context_window` assistant falls back to the department model at 200k. Nothing breaks.

## Acceptance criteria

- [x] `buildEnvOverride` writes `ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.3[1m]` and keeps the other
      three on the department model; no slots resets opus (unit tests).
- [x] `validateConfig` rejects a bad slot name, a slot alias outside `model_aliases`, and a
      `claude_selection` of `glm-5.3` or `opus[1m]`. It accepts `glm-5.3[1m]` when `glm-5.3` is an
      alias (unit tests).
- [x] `planWrites` pins `opus` and stays quiet once pinned (unit tests). The managed install pins
      `opus` for that assistant only and writes only the opus slot (`managedClaudeSelection.test.ts`).
- [x] Each sheet entry list hides model / thought-level under a locked capability and keeps them
      when selectable. Each test fails with the fix reverted (`GuidActionRow`, `AcpSendBox`,
      `AionrsSendBox` DOM tests).
- [x] Live (NexWork-Dev, local cynapse, direct upstream, 2026-10-23):
  - `/config` serves `claude_slots {"opus": "glm-5.3[1m]"}` and `claude_selection: "opus"` on
    purchase-req-review only.
  - The agent env has `OPUS=glm-5.3[1m]` with the other three on `glm-5.3-flash`.
  - A new purchase conversation logs
    `set_model applied requested_model=opus running_model=glm-5.3[1m]`, and its transcript records
    `glm-5.3`.
  - A new default-assistant conversation in the same app records `glm-5.3-flash`.
- [ ] Production: a request over 200k tokens through LiteLLM's `glm-5.3` route returns normally.
      This checks that the gateway forwards `context-1m-2025-08-07`, or that the upstream does not
      need it (cynapse §18).
