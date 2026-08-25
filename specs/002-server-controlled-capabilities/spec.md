# Feature Specification: Server-Controlled Capability Policy

**Feature Branch**: `nex-work`
**Created**: 2026-08-25
**Status**: Draft, revision 2 — awaiting approval before implementation
**Review**: revised after an adversarial review found four design defects; see _Review Corrections_
**Input**: "服务端能否控制前端的功能…我想要准确的识别到用户究竟想要做什么，以及说是用什么样的模型、怎么调度 agent，这些都是在后台做，为了更好的收集数据来改进系统。所以我希望能够服务端控制功能开关…目前先实现隐藏 CLI（对于用户来说没办法控制 CLI 是什么，感知不到什么是 CLI，没有 claude code、codex 这种感知的区别，以及不能控制模型）"

## Why

NexWork's value comes from the server deciding what happens: recognising what the user actually
wants, choosing the model, and scheduling agents. That server-side decision loop is what produces
usable trajectories and what lets us improve the system and cut cost over time.

Today the desktop app pushes those decisions onto the user. It asks them to pick a CLI backend
(Claude Code vs. Codex vs. Gemini) and a model, in ~30 places. Every such choice is a decision the
server did not make, and therefore a trajectory that teaches us nothing about our own routing.

Clerical staff also should not have to know what a "CLI" is. The concept is an implementation
detail of how we run agents; exposing it is a usability cost with no upside.

## Current state (what already exists)

- **`Assistant` already binds CLI + models.** `assistant.agent.type` / `acp_backend` is the CLI;
  `assistant.models[]` is the model set. Users picking an assistant are already, indirectly, not
  picking a CLI — the UI simply also exposes the layer underneath.
- **Server-pinned model already exists.** `AssistantDetail.defaults.model` is
  `{ mode: 'fixed' | 'auto', value }`. `mode: 'fixed'` pins the model to the assistant definition.
  `permission` and `thought_level` work the same way. **This capability does not need to be built.**
- **No policy channel exists.** `/api/settings/client` is a user-preference bag the renderer can
  `PUT` freely — unusable as an authority. `aioncore` is a _local_ 127.0.0.1 binary owned by
  upstream, not our server. `AuthContext` is a local WebUI session, not company identity.

So the gap is narrower than it first appears: what is missing is a **read-only capability channel**
and the UI gating that consumes it.

## Scope boundary — what this phase actually is

This phase delivers **L1** (a capability channel) and **L2** (UI concealment). It delivers neither
enforcement nor server-side routing, and the spec must not be read as if it did.

Three separate claims, only the first of which this phase satisfies:

| Claim                                              | Delivered here?                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| Staff cannot _perceive_ which CLI or model is used | Yes                                                                      |
| Staff cannot _bypass_ server routing               | No — that is L3, in the backend repo. Devtools still reveals the runtime |
| The _server_ decides the runtime and model         | **No** — see below                                                       |

**This phase does not implement constitution Principle I ("The Server Decides").** With the shipped
static provider there is no server in the loop at all: selecting an assistant still selects its
client-bound runtime and model, and concealing that fact does not turn it into a routing decision or
produce a routing trajectory. What this phase builds is the _channel and the gating_ that a real
server decision will later flow through, plus the concealment that has independent usability value.

Principle I is satisfied only when the remote provider is enabled **and** the backend actually makes
the routing decision. That is spec 005+, and this spec must not be cited as discharging it.

## User Scenarios

1. A clerical user opens the app, picks an assistant by what it _does_, types their task, and sends.
   At no point are they shown a CLI name, a CLI logo, or a model name.
2. The same user opens Settings and finds no agent-management page and no model-provider
   configuration. There is no surface that implies a CLI exists.
3. A user browses conversation history. Past conversations show the assistant, not the runtime that
   served them.
4. An administrator changes policy centrally; the next app start reflects it without a release.
5. The policy source is unreachable at start (offline, server down). The app still works: CLI and
   model identity stay concealed, **and the user can still send a message**. Concealment degrades
   toward hidden; operability never degrades.

## Functional Requirements

- **FR-1** A capability policy is resolved at app start and exposed to the renderer as a **read-only**
  set. Nothing in the renderer can write to it.
- **FR-2** Policy resolution goes through a provider interface with at least two implementations: a
  **static local provider** (the default, shipped) and a **remote provider** (wired, disabled until
  the backend endpoint exists). Swapping providers must require no change to any gating call site.
- **FR-3** When `cli.visible` is off, no surface reveals the CLI/runtime identity: no selector, no
  badge, no logo, no runtime name in labels, tooltips, settings or conversation history.
- **FR-4** When `model.userSelectable` is off, no model selector is rendered anywhere, and the model
  used comes from the assistant definition. If the assistant's fixed model is not present in the
  provider catalogue, the app must **not** silently fall back to some other model — that would hide a
  wrong-model send behind a hidden selector. It must surface a blocked state naming the assistant.
- **FR-5** Hiding a selector must never break sending. A surface may only be gated once a resolvable
  default is guaranteed for it.
  **Known gap: this does not currently hold for `aionrs`.** ACP tolerates an omitted model override —
  the CLI picks its own default — but aionrs does not. With no configured provider,
  `useGuidModelSelection` selects nothing (`useGuidModelSelection.ts:75`), `GuidPage.tsx:403` applies a
  fixed model only when it exists in the provider list, and the send path rejects
  (`useGuidSend.ts:173`, and `AionrsSendBox.tsx:254` for existing conversations). Gating the aionrs
  model selector is therefore **blocked** until aionrs has a guaranteed default. Ship ACP gating
  first; track aionrs separately.
- **FR-6** Policy is cached locally and survives restart, so an offline start behaves like the last
  online start.
- **FR-7** Fetch failure splits along two axes, and they resolve in opposite directions:
  - **Concealment fails closed.** A server outage must not reveal CLI or model identity.
  - **Operability fails open.** Concealment must never be the reason a user cannot send, reach
    settings, or recover. Where the two collide — a hidden selector whose default cannot be
    resolved — operability wins and the control is shown, because CLI identity is explicitly _not_ a
    security boundary (see _Scope boundary_). Making recovery impossible is the worse failure mode.
- **FR-8** The trajectory record states which policy was in force and where it came from
  (`static` / `cached` / `remote`, plus policy version). It must not claim a server made a decision
  when the static provider was in force.

## Surfaces to gate (~30 listed; the inventory is known to be incomplete)

| Group           | Files                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selectors       | `GuidModelSelector`, `AcpModelSelector`, `AionrsModelSelector`, `GoogleModelSelector`, `AgentModeSelector`, `RuntimeSelectorPill`, `runtimeSelectorOptions` |
| Settings        | `pages/settings/AgentSettings/*` (whole section), `ModelModalContent`, `AssistantEditorSections`, `ArchivedSettings`                                        |
| Identity        | `AgentBadge`, `agentLogo`, `RuntimeBadge`, `ThemedLogo`, `MobileConversationBrand`, `conversationAssistantIdentity`                                         |
| Conversation    | `ChatConversation`, `ChatLayout`, `SingleChatEmptyState`, `AcpSendBox`, `AionrsSendBox`, `MessageText`                                                      |
| History         | `GroupedHistory/ConversationRow`, `ConversationSearchPopover`                                                                                               |
| Scheduled tasks | `CreateTaskDialog`, `TaskDetailPage`, `jobAgentMeta`, `ScheduledTasksPage`                                                                                  |

## Key Entities

- **CapabilityPolicy** — a versioned, flat map of capability keys to values, plus the metadata needed
  to cache and revalidate it.
- **PolicyProvider** — resolves a `CapabilityPolicy`. Implementations: static, remote, cached.
- **Capability key** — initially `cli.visible`, `model.userSelectable`, `agent.settingsVisible`.

## Acceptance Criteria

- [ ] With the shipped default policy, a full pass through the app surfaces zero CLI names, CLI logos
      and model names. A "grep the rendered tree" test is **not sufficient** — it passes while lazy
      routes, modals, mobile states and error states stay unmounted. Error and recovery states must be
      driven into view explicitly
- [ ] Sending a message works with every selector hidden, for each assistant type that is gated
- [ ] An assistant whose fixed model is absent from the catalogue produces a named blocked state, not
      a silent substitution (FR-4)
- [ ] Flipping a policy key re-renders the affected surfaces without a restart
- [ ] With no cached policy and an unreachable source: CLI and model identity stay hidden **and a
      message can still be sent** (FR-7, both axes)
- [ ] Swapping static → remote provider changes no gating call site (verified by diff)
- [ ] `tsc`, `lint`, `format:check`, `check-i18n`, full test suite pass
- [ ] Upstream-drift accounting recorded in `plan.md`

## Open Questions

- **OQ-1** Remote endpoint contract: URL, auth (device identity vs. staff login), payload shape,
  cache TTL. Needs the backend repo. Blocks the remote provider only, not this spec.
- **OQ-2** Policy granularity — per-install, per-user, or per-role? Affects whether the remote
  provider needs identity before it can ask for policy.
- **OQ-3** Resolved: the constitution was replaced (spec 003). Principle I now states that the server
  decides — which this phase does **not** yet satisfy, by its own admission above.
- **OQ-4** What is the guaranteed aionrs default that would unblock FR-5 for it? Likely a
  backend-supplied fallback model rather than anything the desktop can synthesise.

## Review Corrections

Revision 2 after an adversarial review. Four defects, all in the spec rather than in code, which is
the cheapest place for them to be found:

1. **The spec claimed a server decision it does not make.** With the static provider there is no
   server in the loop; FR-8's original wording ("when the server hid a choice") was simply false.
   Corrected in _Scope boundary_ and FR-8, and Principle I is explicitly **not** claimed.
2. **FR-5 was unachievable for aionrs.** ACP tolerates an omitted model; aionrs rejects the send.
   Recorded as a named blocked gap rather than an aspiration.
3. **FR-7 contradicted scenario 5.** Fail-closed on everything meant an unreachable server could
   leave a user unable to send or recover — for a boundary the spec itself says is not a security
   boundary. Split into concealment (fails closed) and operability (fails open).
4. **The surface inventory was materially incomplete** — error dialogs, import wizards, channel forms
   and team mode all leak CLI or model identity and were missing. Added, and the acceptance criterion
   now rejects a rendered-tree grep as sufficient evidence.
