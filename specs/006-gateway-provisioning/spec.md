# Feature Specification: Gateway Provisioning

**Feature Branch**: `nex-work`
**Created**: 2026-08-26
**Status**: Implemented — all five push gates green (lint 0 errors, fmt, tsc, check-i18n, 5058 tests)
**Resolves**: spec 002 **OQ-1**

## Why

Spec 002 left one dependency marked as the thing that blocks shipping:

> **OQ-1** LiteLLM provisioning: how does a fresh install learn the gateway URL and key? This gates
> FR-5 for aionrs and is the one dependency that blocks shipping.

Today there is no answer, and worse, there are **two unrelated answers** depending on which runtime
serves the request:

- **aionrs** reads a provider row (`platform: 'custom'`, `base_url`, `api_key`) configured through
  `AddPlatformModal`.
- **CLI agents** (Claude Code, Codex) read `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` from a
  **raw name/value env-override editor** (`AgentSettings/AgentRepairPanel.tsx`, persisted via
  `PUT /api/agents/:id/overrides`).

Nothing keeps the two in agreement, and nothing reports when one of them is unset. An unset one does
not degrade — it **silently routes around the gateway**, which spec 002's own Boundaries section
already anticipated:

> **LiteLLM is an enforcement point only for what flows through it.** An ACP CLI configured with its
> own credentials would bypass it.

Two consequences follow, and the second is the one that makes this urgent:

1. Principle I (_The Server Decides_) is only true for traffic that reaches the gateway. Model
   remapping via LiteLLM aliases does nothing for a runtime pointed elsewhere.
2. Principle II (_Data Collection Is the Point_) fails **silently and unrecoverably**. Collection is
   gateway-side; a session that bypassed the gateway leaves no record anywhere, and there is no
   later opportunity to notice it was missing. A corpus with holes it cannot detect is worse than a
   smaller corpus.

## What this does

One **Gateway** setting: base URL + key, entered once. On save it provisions _every_ runtime — the
aionrs provider row and each CLI agent's env override — and then **shows which runtimes are actually
pointed at it**.

The visibility half is not decoration. Without it the failure mode stays exactly what it is today:
silent, and only discoverable by noticing an absence.

## Boundaries

- **Not a security boundary.** A user with settings access can still edit an env override afterwards.
  The goal is that the correct configuration is the default and that deviation is _visible_, not that
  it is impossible. Same posture as spec 002's stance on UI gating.
- **Does not make the gateway the only reachable path.** That is a deployment concern (firewall /
  egress policy), unchanged by this spec.
- **Does not introduce a server-to-client channel.** Provisioning is local and user-entered; the
  remote `PolicyProvider` of spec 002 remains wired-but-disabled.
- **Credentials stay where they already live** — the provider row and the agent override store. This
  spec adds no new secret storage.

## User Scenarios

1. Fresh install. User opens Settings → Gateway, enters URL and key, saves. Both an aionrs
   conversation and a Claude Code conversation are served through the gateway, with no further setup.
2. Settings → Gateway lists every runtime with its status: **pointed at gateway** / **not configured**
   / **manually overridden**. The third state names the conflicting value.
3. A user had previously hand-entered an env override. Saving the gateway setting **does not silently
   replace it** — it is surfaced as a conflict with an explicit "use gateway" action.
4. The gateway is unreachable at save time. The value is still saved and the failure is reported;
   the app never becomes unusable because a gateway check failed (spec 002 FR-7: operability fails open).

## Functional Requirements

- **FR-1** A single Gateway settings surface accepts a base URL and a key, and is the only place a
  user is asked for them.
- **FR-2** Saving provisions **all** runtimes in one action: the aionrs `custom` provider row, and
  `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` in every CLI agent's `env_override`.
- **FR-3** The surface reports per-runtime status. **"Not configured" must be visually distinct from
  "pointed at gateway"** — this is the requirement that turns a silent hole into a visible one.
- **FR-4** An existing manual override is never overwritten without the user seeing it. Conflict is
  surfaced with the current value and an explicit action to replace it.
- **FR-5** A reachability check may run on save, but its result never blocks saving.
- **FR-6** The key is write-only in the UI after first save (masked, replaceable, not readable back) —
  consistent with how provider keys are already handled.

## Key Entities

- **GatewayConfig** — `{ baseUrl, apiKey }`. One per install.
- **RuntimeGatewayStatus** — `{ runtimeId, state: 'gateway' | 'unset' | 'overridden', currentValue? }`.

## Acceptance Criteria

- [x] Fresh install → enter URL + key once → an aionrs request and a Claude Code request both appear
      in `LiteLLM_SpendLogs`
- [x] A runtime with no gateway config is visibly flagged, not silently left alone
- [x] A pre-existing manual override is surfaced as a conflict, never silently replaced
- [x] Gateway unreachable at save → value persists, error reported, app remains usable
- [x] Key is not readable back from the UI after save
- [x] `tsc`, `lint`, `format:check`, `check-i18n`, full suite pass; drift accounted in `plan.md`

## Open Questions

- **OQ-1** Do non-Anthropic CLI agents (Codex, Gemini) need their own variable names
  (`OPENAI_BASE_URL`, …)? Out of scope for the prototype — **only Claude Code is in scope** (see the
  server-side design doc) — but the data shape should not preclude it.
- **OQ-2** Should provisioning apply retroactively to agents installed _after_ the gateway was
  configured? Prototype answer: yes, apply at agent-registration time; needs a hook point.

## Relationship to the server side

This spec is one half of an end-to-end change. The other half is
`cynapse:doc/spec/2026-08-26-轨迹采集-design.md`, which covers the two LiteLLM settings that make
collection non-empty, the `tool-results/` sync, and storage governance.

**Neither half is verifiable alone**: the collection chain is _NexWork sends → LiteLLM records →
join against synced `tool-results/`_. If runtimes are not provisioned onto the gateway, the chain has
no input and the server-side work cannot be tested.
