# Feature Specification: Server-Controlled Capability Policy

**Feature Branch**: `nex-work`
**Created**: 2026-08-25
**Status**: Implemented, revision 6 — partially verified; see _Acceptance Criteria_
**Revisions**: rev 2 fixed four defects found by adversarial review; rev 3 rewrote the architecture
around the private LiteLLM gateway and one-way trajectory export; rev 4 records implementation and
what rendering the app changed about it; rev 5 conceals bare-CLI assistants from selection lists —
the fresh-install home pill bar was a CLI roster; rev 6 makes CLI version-drift notices dev-only
and re-pins the bundled Claude to the version aioncore verifies.

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
- **Collection happens at the gateway, not in the client.** LiteLLM logs what flows through it, so
  the client does not export trajectories (spec 005, withdrawn). The client's obligation is to make
  gateway records attributable — see FR-8.
- **There is no server-to-client channel yet.** Backend integration is one-way and unauthenticated,
  so **server-driven policy cannot be fetched**. This is why the static provider ships: it is forced
  by the backend design, not chosen for convenience.
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
- **FR-8** Every request to the LiteLLM gateway carries **provenance as request metadata**: the
  assistant id, the policy version, and the policy source (`static` / `cached` / `remote`). LiteLLM
  passes metadata through to its logs, so the gateway's records are attributable without the client
  exporting anything. It must not claim a server decision when the static provider was in force.
  This ships from day one — a corpus without provenance cannot later be split into "server routed
  this" and "local default did".

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
- **Provenance is sent before there is anything but `static` to report.** Adding it later would leave
  the earliest gateway logs — the data we most want for training — unattributable.

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
- **Capability key** — `cli.visible`, `model.userSelectable`, `agent.settingsVisible`,
  `provider.userConfigurable`.

  The fourth key was added during implementation. `agent.settingsVisible` governs whether a page can
  be **reached**; `provider.userConfigurable` governs whether the gateway can be **written around**.
  This spec says UI gating is not a security boundary — true of hiding a CLI's name, false of the
  env editor, which is a free-form key/value form that accepts `ANTHROPIC_BASE_URL`, the variable
  spec 006 writes to pin every runtime at the company gateway. A row typed there routes that
  runtime off the gateway, and traffic that never reaches the gateway leaves no record anywhere.
  Collapsing the two means the day an administrator is shown the settings page, the write path
  comes back with it.

## Acceptance Criteria

Marked against what was actually exercised (constitution principle V).

- [x] **Zero CLI logos, and zero CLI names once the agent rows are renamed.** Measured with a
      headless browser over nine routes plus two mobile viewports, reading the rendered text and
      every `<img>` src: vendor logos **0**. CLI text reaches **0** after renaming
      `agent_metadata.name`, verified by doing exactly that against the live database and scanning
      again. The requirement above was right that grepping is not sufficient — this pass is what
      found three separate avatar resolvers, a vendor logo arriving through the `icon` field, a
      literal "CLI" tag, and a crash that blanked every settings page.
- [x] **Swapping static → remote changes no gating call site.** Verified by diff: a remote provider
      added as a new file type-checks and `git status` shows that file and nothing else.
- [x] **`tsc`, `lint`, `format:check`, `check-i18n`, full suite pass** — 5093 tests, 0 lint errors.
- [~] **Sending works with every selector hidden.** The default resolves —
  `useGuidModelSelection` picks `modelList[0]` whenever the list is non-empty, which the
  gateway provider row now guarantees after the spec 006 fix. A send was **not** driven through
  the gated UI end to end.
- [~] **A named blocked state, not a substitution.** Implemented and it names the assistant; the
  state was not driven into view, because reaching it means removing the gateway's models.
- [~] **Flipping a key re-renders without a restart.** `useSyncExternalStore` gives this by
  construction and the store's notify path is unit-tested; no surface was flipped live.
- [ ] **Unreachable source with no cache** — the shipped provider is static, so there is no source
      to make unreachable. Untestable until a remote provider exists.
- [~] **Provenance on every decision record (FR-8)** — the carrier is built and tested
  (`common/capabilities/provenance.ts`), and verified end to end against a live gateway:
  `x-litellm-spend-logs-metadata` lands verbatim in
  `LiteLLM_SpendLogs.metadata.spend_logs_metadata`. A more intuitive route was measured and
  **ruled out** — custom `x-cynapse-*` headers are not recorded; LiteLLM's
  `requester_custom_headers` only keeps an allowlist (`x-claude-code-*`, `x-stainless-*`,
  `x-app`).
  **Not yet attached to outgoing requests.** The CLI runtimes send their own HTTP; the header
  has to be injected where the runtime is spawned, which is the remaining work. Until then the
  deadline still runs: records produced now do not carry provenance and never will.

### What rendering the app changed

The unit suite was green and the shipped policy still put every vendor logo on the first screen a
clerk sees. Four things were only findable this way:

- **Avatar resolution is written three times** — `resolveAssistantAvatar`, `resolveAgentAvatar`,
  `resolveAvatarImageSrc` — and eight call sites reach the first directly, bypassing the wrapper.
  Each had to be gated separately; each was found by looking at the page again after the last fix.
- **A managed agent's `icon` field already _is_ a vendor logo path.** Resolution short-circuits on
  an explicit icon, so "an explicit icon is the assistant's own identity" was wrong for exactly the
  agents that matter. All 41 icons the backend serves sit under `/api/assets/logos/`, which is the
  discriminator now used.
- **Spec 006 crashed every settings page in web mode.** It added `gateway` to the id list shared by
  two navigation builders but a row to only one of their maps, leaving an `undefined` that the next
  loop dereferenced. Fixed here, with a regression test.
- **The mobile and wrapper navigation is a second, independent copy** of the sider's menu. Gating
  one left the entries a viewport away.
- **(rev 5) A `generated` assistant _is_ a CLI, and on a fresh install they are the only enabled
  assistants** — the six bare-CLI assistants (Claude Code, Codex CLI, …) rendered the home pill bar
  as a CLI roster. The rev-4 pass measured against the live server, whose `agent_metadata` rows had
  been renamed by hand; a fresh local install has factory rows, so the leak only shows there.
  Fixed at the single source of truth: `selectableAssistants` now drops `generated` assistants when
  `cli.visible` is false, keeping exactly one aionrs-preferred fallback when the list would empty
  (operability fails open, FR-7) — the guid pill labels that survivor neutrally
  (`conversation.welcome.defaultAssistant`, translated in all 13 locales). Every selection surface
  (home, conversation switcher, team create, scheduled tasks, settings list) inherits the filter.
  Surfaces other than the guid pill that render the fallback's own name still say "Aion CLI" — the
  name-side fix stays data-side (renaming rows needs an admin surface; see _The half that is data_).
- **(rev 6) The CLI version-drift notice re-introduced the CLI by name into a concealed
  conversation** — "已安装的 claude 高于 NexWork 验证过的版本 …（本地 2.1.247 (Claude Code) /
  NexWork 验证过 2.1.235）". The verified-version table is baked into the aioncore binary
  (`crates/aionui-session/src/backend/cli_version.rs`: claude → 2.1.235), so the client cannot
  change what is verified — it can only change what runs. Two-sided fix: (a) `claudeCodeVersion`
  in the root `package.json` is re-pinned from 2.1.250 to 2.1.235 so the bundled binary matches
  what aioncore verifies and the notice never fires on a healthy install; (b) `MessageTips` drops
  `CLI_VERSION_OLDER` / `CLI_VERSION_NEWER` tips in production builds (`shouldRenderTip`) — the
  employee neither manages the CLI version nor should learn its vendor from a warning box. Dev
  builds keep the notice: there it is real signal (PATH fallback when the bundle is absent, stale
  bundle after a version bump). Rule going forward: **bumping `claudeCodeVersion` and upgrading
  aioncore travel together**, or every production conversation opens with a drift warning only
  dev machines will ever see again.

### The half that is data, not code

`agent_metadata.name` and `.icon` are backend rows. Renaming "Claude Code" needs no client change —
and there is **no admin surface for it**: today it is a direct database write. Concealment is not
complete until those rows are named for the customer, and nothing in the product helps do that.

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
