# Feature Specification: Server-Controlled Capability Policy

**Feature Branch**: `nex-work`
**Created**: 2026-08-25
**Status**: Draft, revision 3 — awaiting approval before implementation
**Revisions**: rev 2 fixed four defects found by adversarial review; rev 3 rewrites the architecture
around the private LiteLLM gateway and one-way trajectory export.

## Why

NexWork's value comes from the system deciding what happens: what the user actually wants, which
model serves it, how agents are scheduled. Every choice pushed onto the user is a decision the server
did not make, and a trajectory that teaches us nothing about our own routing.

Clerical staff also should not have to know what a "CLI" is. It is an implementation detail of how we
run agents; exposing it costs usability and buys nothing.

## Current state — what already exists

Three things exist today, which is why this spec is mostly wiring rather than invention.

- **`Assistant` already binds CLI and models.** `assistant.agent.type` / `acp_backend` is the CLI;
  `assistant.models[]` is the model set. Picking an assistant already means not picking a CLI — the
  UI simply also exposes the layer underneath.
- **Server-pinned model already exists.** `AssistantDetail.defaults.model` is
  `{ mode: 'fixed' | 'auto', value }`. `permission` and `thought_level` work the same way.
- **The private LiteLLM gateway is the real routing point.** The desktop needs no new code to use it:
  - `platform: 'custom'` with a `base_url` is already an OpenAI-compatible provider
    (`modelPlatforms.ts`), so LiteLLM slots in as one.
  - `AgentEnvEntry` (`agentTypes.ts`) already injects environment into a spawned agent, and the app
    ships a description for exactly this scenario — _"Custom API endpoint or gateway (e.g.
    `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`) for self-hosted or proxied services"_. That is how ACP
    CLIs (Claude Code, Codex) are pointed at LiteLLM.

What does **not** exist: any channel by which the server can tell the client anything.

## Architecture — where each guarantee actually lives

| Guarantee                                                   | Mechanism                                                                                                                                             | Real today?               |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| The server decides **which model** serves a request         | **LiteLLM aliases.** The client sends a virtual name; the gateway maps it to an actual model and can remap it at any time without touching the client | **Yes**                   |
| Staff cannot **perceive** CLI or model identity             | UI gating from a capability policy                                                                                                                    | Yes, once built           |
| Staff cannot **bypass** routing                             | LiteLLM is the only configured provider; the gateway sees every request                                                                               | Partly — see _Boundaries_ |
| The server decides **which CLI / how agents are scheduled** | Assistant definitions; later, remote policy                                                                                                           | Not yet                   |

This is the substantive change in revision 3. Reviewers of revision 2 were right that UI gating alone
is concealment of a _client_ decision. With LiteLLM in the path the model decision is genuinely made
server-side, so gating conceals a decision the server actually makes. **Model control is real; CLI
and scheduling control are not yet.**

## Boundaries — stated so they are not blurred later

- **UI gating is not a security boundary.** Devtools still reveals which runtime is executing. This
  is acceptable: the goal is that staff do not _think in terms of_ CLIs, not that a determined
  engineer cannot find out.
- **LiteLLM is an enforcement point only for what flows through it.** An ACP CLI configured with its
  own credentials would bypass it. Making the gateway the _only_ reachable path is a deployment
  concern, not something this spec delivers.
- **Trajectory export is one-way and unauthenticated.** The desktop pushes; nothing comes back.
  **Therefore server-driven policy cannot be fetched yet** — this is why the static provider ships,
  and it is a consequence of the backend design, not a convenience.
- **Auth arrives later, likely via an MCP endpoint.** Out of scope here.

## User Scenarios

1. A clerical user opens the app, picks an assistant by what it _does_, types their task, sends. No
   CLI name, CLI logo or model name is shown at any point.
2. Settings contains no agent-management page and no model-provider configuration. Nothing implies a
   CLI exists.
3. Conversation history shows the assistant, not the runtime that served it.
4. An administrator remaps a LiteLLM alias. The next request is served by a different model, with no
   client change and no release.
5. The policy source is unreachable. CLI and model identity stay concealed **and the user can still
   send a message**. Concealment degrades toward hidden; operability never degrades.

## Functional Requirements

- **FR-1** A capability policy is resolved at app start and exposed to the renderer as a **read-only**
  set. Nothing in the renderer can write to it.
- **FR-2** Policy resolution goes through a `PolicyProvider` interface. Implementations: **static**
  (ships now), **cached**, **remote** (wired, disabled). Swapping providers must require no change to
  any gating call site — verified by diff.
- **FR-3** When `cli.visible` is off, no surface reveals CLI/runtime identity: no selector, badge,
  logo, runtime name in labels, tooltips, settings or conversation history.
- **FR-4** When `model.userSelectable` is off, no model selector renders anywhere, and the model comes
  from the assistant definition. If the assistant's fixed model is absent from the catalogue, the app
  must **not** silently substitute another — that hides a wrong-model send behind a hidden selector.
  It surfaces a blocked state naming the assistant.
- **FR-5** Hiding a selector must never break sending. A surface may only be gated once a resolvable
  default is guaranteed for it.
  **With LiteLLM configured as the single provider this is satisfiable for `aionrs` too** — the
  revision 2 blocker was "no configured provider → send rejected" (`useGuidModelSelection.ts:75`,
  `GuidPage.tsx:403`, `useGuidSend.ts:173`, `AionrsSendBox.tsx:254`). A company gateway that is always
  present removes the precondition. **Gating aionrs therefore depends on LiteLLM provisioning, and
  must not ship before it.**
- **FR-6** Policy is cached locally and survives restart, so an offline start behaves like the last
  online start.
- **FR-7** Fetch failure resolves on two axes, in opposite directions:
  - **Concealment fails closed** — an outage must not reveal CLI or model identity.
  - **Operability fails open** — concealment must never be why a user cannot send, reach settings or
    recover. Where they collide, operability wins, because CLI identity is explicitly not a security
    boundary.
- **FR-8** Every decision record carries **provenance**: which policy was in force, its version, and
  its source (`static` / `cached` / `remote`). It must not claim a server decision when the static
  provider was in force. This ships from day one — a corpus of records without provenance cannot
  later be split into "server routed this" and "local default did".

## Forward compatibility — decided now, so the backend costs nothing later

The backend cannot yet specify its endpoint. These choices make that irrelevant:

- **The policy payload is shaped for remote delivery from the start** — `version`, `source`, `ttl`,
  `etag`, plus the capability map. The static provider fills them with fixed values. A remote provider
  changes no consumer.
- **Capability keys are the only vocabulary at gating call sites.** No call site knows which provider
  answered. This is what makes FR-2's diff check meaningful.
- **Model identity at the wire is a LiteLLM alias, never a vendor model name.** Aliases are stable
  across gateway-side remapping; vendor names are not. A trajectory recording `claude-sonnet-4` binds
  the corpus to a routing decision that may change tomorrow.
- **Provenance is recorded before there is anything but `static` to record.** Adding it later would
  leave the earliest data — the data we most want for training — unattributable.

## Surfaces to gate (~30 listed; the inventory is known to be incomplete)

| Group            | Files                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selectors        | `GuidModelSelector`, `AcpModelSelector`, `AionrsModelSelector`, `GoogleModelSelector`, `AgentModeSelector`, `RuntimeSelectorPill`, `runtimeSelectorOptions` |
| Settings         | `pages/settings/AgentSettings/*`, `ModelModalContent`, `AssistantEditorSections`, `ArchivedSettings`                                                        |
| Identity         | `AgentBadge`, `agentLogo`, `RuntimeBadge`, `ThemedLogo`, `MobileConversationBrand`, `conversationAssistantIdentity`                                         |
| Conversation     | `ChatConversation`, `ChatLayout`, `SingleChatEmptyState`, `AcpSendBox`, `AionrsSendBox`, `MessageText`                                                      |
| History          | `GroupedHistory/ConversationRow`, `ConversationSearchPopover`                                                                                               |
| Scheduled tasks  | `CreateTaskDialog`, `TaskDetailPage`, `jobAgentMeta`, `ScheduledTasksPage`                                                                                  |
| Error & recovery | `main.tsx:221` resolves literal "Codex ACP" / "Claude ACP"; `TeamWarmupOverlay.tsx:188` tells users to switch models                                        |
| Import wizards   | `OneClickImportModal.tsx` — literal Claude/Codex options, "Select CLI" label                                                                                |
| Channel forms    | all 7 under `SettingsModal/contents/channels/` — model sections, "CLI runtime model" descriptions                                                           |
| Team mode        | `TeamPage.tsx:452` mounts ACP/Aionrs selectors independently of the guid page                                                                               |

## Key Entities

- **CapabilityPolicy** — `{ version, source, ttl, etag, capabilities }`.
- **PolicyProvider** — resolves a `CapabilityPolicy`. Static / cached / remote.
- **Capability key** — initially `cli.visible`, `model.userSelectable`, `agent.settingsVisible`.

## Acceptance Criteria

- [ ] With the shipped default policy, a full pass surfaces zero CLI names, CLI logos and model names.
      A "grep the rendered tree" test is **not sufficient** — it passes while lazy routes, modals,
      mobile and error states stay unmounted. Error and recovery states must be driven into view
- [ ] Sending works with every selector hidden, for each gated assistant type
- [ ] An assistant whose fixed model is absent produces a named blocked state, not a substitution
- [ ] Flipping a policy key re-renders affected surfaces without a restart
- [ ] Unreachable source with no cache: identity stays hidden **and** a message can still be sent
- [ ] Swapping static → remote changes no gating call site (verified by diff)
- [ ] Every decision record carries provenance, including under the static provider
- [ ] `tsc`, `lint`, `format:check`, `check-i18n`, full suite pass; drift accounted in `plan.md`

## Open Questions

- **OQ-1** LiteLLM provisioning: how does a fresh install learn the gateway URL and key? This gates
  FR-5 for aionrs and is the one dependency that blocks shipping.
- **OQ-2** Alias vocabulary — what virtual model names does the gateway expose, and who owns them?
- **OQ-3** Resolved: the constitution was replaced (spec 003) and its data boundaries are suspended
  for the prototype (rev 3 of that spec), so nothing here is gated on them.
- **OQ-4** Resolved by LiteLLM: the aionrs default gap closes once a gateway provider is always
  present.

## Review Corrections

**Revision 2** — four defects, found by adversarial review before any code was written:
the spec claimed a server decision it did not make; FR-5 was unachievable for aionrs; FR-7's
fail-closed default contradicted the offline scenario; the surface inventory was materially
incomplete.

**Revision 3** — the LiteLLM gateway and the one-way export change two of those conclusions:
model routing _is_ a real server decision, and the aionrs gap has a route to closure. It also makes
explicit why the static provider ships — one-way export means there is no channel to fetch policy
over, not that a remote channel was skipped for convenience.
