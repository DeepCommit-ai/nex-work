# Feature Specification: Gateway Provisioning

**Feature Branch**: `nex-work`
**Created**: 2026-08-26
**Status**: Implemented; partially verified — logic and the Claude Code path are exercised against a
live instance, the UI is unrendered (headless machine) and the aionrs path is untested. See
_Acceptance Criteria_.
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

Marked honestly against what was actually exercised (constitution principle V). An earlier revision
blanket-marked every box; that was corrected, and revision 2 then closed the two remaining gaps by
driving the aionrs path against a live gateway — which found four defects the unit suite could not.

- [x] **Gates** — `tsc`, `lint`, `format:check`, `check-i18n`, full suite (5058 tests) all pass;
      drift accounted in `plan.md` with measured numbers
- [x] **A Claude Code request reaches `LiteLLM_SpendLogs`** — verified against a live instance:
      `call_type=anthropic_messages`, `user-agent: claude-cli/2.1.246`, real GLM responses,
      `session_id` matching `acp_session.session_id`
- [x] **The backend accepts what `buildEnvOverride` produces** — PUT/GET round trip verified
      (`tests/integration/gatewayProvisioning.live.test.ts`, run with `NEXWORK_LIVE=1`)
- [x] **Every runtime gets a status, none omitted** — verified against the live agent list

Logic verified by unit test, **UI never rendered** (headless machine, no browser):

- [~] A runtime with no gateway config is flagged — `classifyRuntime` returns `unset` for
  missing/blank values (tested); the visual distinction in `StateTag` is unexercised
- [~] A manual override is surfaced as a conflict, never silently replaced — `planProvisioning`
  excludes unresolved conflicts from `toWrite` (tested); the conflict row and "use gateway"
  action are unexercised
- [~] The key is not readable back after save — `buildEnvOverride` keeps the stored token when the
  field is blank (tested); `Input.Password` masking and the post-save field reset are unexercised

Verified in revision 2, after the defects below were fixed:

- [x] **An aionrs request reaches `LiteLLM_SpendLogs`** — three turns driven through a live
      `aionrs` conversation against the company LiteLLM; each produced a `call_type=acompletion`
      row with real `spend`, and each got a correct model reply back. Exercising this is what
      surfaced D1 and D2 below: as shipped in revision 1, this state was **unreachable**.
- [x] **Gateway unreachable at save → value persists, error reported, app remains usable**
      (FR-5/FR-7) — the write persists unchanged, and the save now probes the gateway first and
      reports when it does not answer. Before this, an unreachable address was accepted in silence
      and every runtime still showed the green "reaches the gateway" tag (D3).

### Defects found by actually exercising the aionrs path

Every one of these passed `tsc`, `lint` and the full unit suite. None was visible without a live
backend, which is the argument for the live tests rather than more unit tests.

- **D1 — the provider row carried no models.** `save()` created it with `{name, platform, base_url,
  api_key}` and nothing else. `getAvailableModels` iterates `provider.models`, so aionrs could
  select nothing and send nothing. Fixed: the save probes the gateway's model list first
  (`POST /api/providers/fetch-models`, anonymous) and writes it into the row. This also answers
  spec 002's **OQ-2** — the alias vocabulary is whatever the gateway advertises, and the client
  never carries a list of its own.
- **D2 — every save appended a duplicate row.** `planProvisioning` puts already-provisioned
  runtimes in `toWrite`, and the aionrs branch always called `createProvider`. Verified live: two
  saves, two `NexWork Gateway` rows, the second with an empty model list — while the status read
  (`find` by name) kept reporting the first. Fixed: the status read returns the row id and the save
  updates in place.
- **D3 — the green tag asserted a health it never checked.** `classifyRuntime` compares URL strings.
  A typo in the port persisted happily and every runtime reported `gateway`. Fixed by the same
  probe, reported separately from the per-runtime tags because reachability is a property of the
  gateway, not of any one runtime.
- **D4 — a needless `as never` on the `createProvider` call.** Confirmed unnecessary by
  type-checking the call without it. It would have hidden exactly the kind of shape mismatch D1 was.

### Known limitation — aionrs traffic is not attributable

The traffic arrives; the attribution does not. Measured against the live gateway:

- aionrs has no `acp_session` row — that table is written by the ACP path, and `aionrs` is not ACP.
  The conversation id appears nowhere in `LiteLLM_SpendLogs`.
- `session_id` on an aionrs row is generated per call, not per session: two turns of the *same*
  conversation produced `4820a338…` and `675ca681…`. It is not a session key.

So the join chain the collector relies on — `LiteLLM_SpendLogs.session_id` → `acp_session.session_id`
→ the transcript file — covers ACP CLI runtimes only. aionrs rows are orphans: correctly billed,
un-attributable. Closing this needs the client to put a stable conversation id on the
OpenAI-compatible request, which is out of scope here and is filed rather than hidden.

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
