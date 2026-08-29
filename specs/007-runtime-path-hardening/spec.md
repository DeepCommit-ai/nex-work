# Feature Specification: Runtime Path Hardening

**Feature Branch**: `nex-work`
**Created**: 2026-08-29
**Status**: Implemented, verified live on the dev machine

## Why

Two field defects, one theme: **resolution that walks the machine's PATH (or a path derived from
the wrong anchor) silently loses to whatever is broken or misplaced on the employee's machine.**
Both were found on the same dev machine, whose PATH-first node (brew node 25.6.1) dies on launch
with a missing `libllhttp` dylib — an accident locally, but exactly the kind of machine state an
enterprise deployment must survive, and the reason aioncore ships a managed node runtime and this
fork bundles a pinned Claude in the first place.

### D1 — `aionui-browser` MCP dead on machines with a broken PATH node

Measured at startup (2026-08-29):

```
[builtin-mcp-browser] Connecting chrome-devtools-mcp to the in-app browser bridge at http://127.0.0.1:49702
dyld: Library not loaded: /opt/homebrew/opt/llhttp/lib/libllhttp.9.3.dylib   ← PATH-first node
mcp server connection failed server=aionui-browser error=Transport error: Child process stdout closed
```

The launcher itself runs under aioncore's managed node — but it spawns bare `npx`, and `npx` is a
`#!/usr/bin/env node` script that **re-resolves `node` from the inherited PATH**. The managed
runtime's own `npx` has the same shebang, so even an absolute-path spawn would not have helped.
Electron rebuilds PATH from the login shell, so however the app is launched, the broken node wins
and the browser tools silently vanish.

### D2 — managed-claude never pins in dev (wrong derivation anchor)

`deriveClaudeBinaryPath` walks `<aioncore bin dir>/../../bundled-claude/…`, which is the
distribution layout. In dev, aioncore resolves from PATH (`~/.local/bin/aioncore`), so the walk
lands on `~/bundled-claude` — measured: `[managed-claude] 没有捆绑载荷（/Users/synapse/bundled-claude/…
不存在）——跳过`. The payload prepared by `scripts/prepareClaude.js` sits in the repo's
`resources/bundled-claude/`, so "re-pin on every start" never happened in dev, and the CLI
version-drift notice (spec 002 rev 6) kept firing against the employee-installed claude.

### D3 — the same broken node, one lane deeper: claude's `--mcp-config`

Fixing D1 revived the wrapper only where **aioncore** spawns it (aionrs sessions, verified
`tools=26`). A Claude Code conversation showed no browser tools at all, and the reason took three
probes to isolate:

- The browser MCP **was** being handed to claude — `--mcp-config {"mcpServers":{"aionui-browser":
{"command":"node", …}}} --strict-mcp-config` was on the live process, CDP port and token in its
  env. The snapshot rides in from the UI: the assistant's `defaults.mcps.mode=auto` replays
  `preferences.last_mcp_ids`, and the guid page copies the **catalog transport verbatim** into
  `selected_session_mcp_servers` at create.
- claude resolves that bare `command: "node"` **from its inherited PATH** — measured dir by dir:
  the first `node` on it is the broken brew 25.6.1. The MCP child died before the handshake and
  claude listed zero `mcp__aionui-browser__*` tools. aioncore never sees this spawn, so no fix on
  its side of D1 could reach it.

Fix (`mcpNodeCommand.ts` + the every-boot MCP reconcile in `runBackendMigrations.ts`): at each
startup, probe `node --version` **strictly** (upstream `isCommandAvailable` counts any non-ENOENT
failure as available — a dyld crash is precisely such a failure, so it calls the broken node fine);
if unusable, walk aioncore's managed runtime (`<dataDir>/runtime/node/node-v<ver>-…`), verify a
candidate the same way, and write its **absolute path** into the browser MCP transport. A healthy
PATH node keeps the bare `node` — zero drift from upstream rows. The rewritten transport then flows
into every new session snapshot, and the wrapper it starts runs under the managed node, which is
exactly where D1's `buildMcpChildEnv` points the inner `npx`.

Residual, on purpose: a conversation created **before** the rewrite replays its frozen session
snapshot (measured: re-ensuring the old conversation still passes `command:"node"` and the child
dies). Old conversations do not self-heal; new ones are correct.

## Functional Requirements

- **FR-1** The builtin browser MCP launcher must spawn `npx` with the bin directory of **the node
  runtime executing the launcher** prepended to the child PATH (`buildMcpChildEnv`), so both the
  `npx` lookup and npx's `env node` shebang resolve inside a runtime already proven to work.
  Case-variant `Path` keys (Windows) are reused, never duplicated; a missing PATH is created.
- **FR-2** Bundled-claude discovery consults candidates in order (`resolveBundledClaudeCandidates`):
  the distribution layout first, then `<cwd>/resources/bundled-claude/…` (dev repo root). A
  candidate is used only if it exists; when none does, the skip log names every path probed.
  `AIONUI_CLAUDE_BIN` still overrides everything.
- **FR-4** A new conversation's MCP set: an explicit picker selection wins; the assistant's own
  defaults win; an **empty** result falls back to every enabled server in the catalog — matching
  the aionrs factory, so "enabled in the MCP directory" means on-by-default in every lane,
  including the fresh install where no assistant has any MCP history. The one respected empty is
  an admin's `fixed`-mode empty list: a decision, not an absence of one.
- **FR-5** When browser-MCP activity starts and no browser tab is open, the preview panel opens
  one on its own. The single-target bridge attaches only to a mounted, user-visible browser tab —
  by design — but the missing tab must be the app's job, not the employee's: measured live with
  every other link healthy, the first tool call still dead-ended in "The in-app browser is not
  currently attached", relayed to a clerk as an instruction to find a panel they had never seen.
  The tab opens in plain sight and the existing one-time notice explains it; a tab the user closes
  is not reopened by the settling event.
- **FR-5b** Browser-activity detection must recognise the direct-CLI (Claude Code) message shape:
  per-call `tool_call` messages (data is one entry, not a `tool_group` array), tool names prefixed
  `mcp__<server>__<tool>`, lowercase `running`/`completed`/`error` statuses. Measured (conversation
  1cacdbcc): without this shape the detector never fired for claude conversations, so FR-5's
  auto-open was dead code exactly where it was needed and every browser call dead-ended unattached.
- **FR-7** Under single-tab semantics `Target.createTarget` (the MCP's `new_page`) navigates the
  attached page to the requested url and returns the real single targetId, instead of being
  refused. Measured (conversation 1cacdbcc): the agent's natural fallback after a failed
  `list_pages` is `new_page`, so the refusal dead-ended every conversation's first browser use.
  Unattached, it — like every forwarded command — now returns retry guidance ("the panel opens
  automatically on first use — retry the same tool call") in place of the pre-auto-open text that
  sent agents to ask the user for a panel that now opens itself.
- **FR-6** A genuine change of the bridge's attachment — first attach, attach to a different
  webContents (tab switch), or the attached webview being destroyed — closes every connected CDP
  client socket (1012, "reconnect"). Root cause this answers, measured live and confirmed by
  reading the bundled puppeteer: a client that materializes its page while the bridge is
  unattached has its per-command errors (`Network.enable`: "not currently attached") cached in
  puppeteer's `pagePromise` **forever** — every agent retry replays the cached rejection without
  sending a byte, while `/json/list` shows a healthy attached page. No protocol re-announce cures
  it (duplicate `attachedToTarget` swaps sessions and keeps the poisoned target); a disconnect
  does: chrome-devtools-mcp's `ensureBrowserConnected` rebuilds everything on the next tool call.
  Load-bearing negative: a same-webContents re-report (every navigation's dom-ready) must never
  disconnect anyone. Known residual: the first tool call right after a fresh connect can race
  page registration and return "No page selected" once; the immediate retry lands (measured).
- **FR-3** The builtin browser MCP transport must name a node that actually runs on this machine,
  re-resolved at every boot by the same reconcile that already repairs the script path: bare
  `node` while the PATH node passes a strict `--version` probe; otherwise the absolute path of a
  verified binary from aioncore's managed runtime; otherwise bare `node` with a loud log. Never
  blocks startup.

## Acceptance Criteria

- [x] Focused tests: `buildMcpChildEnv` (4 cases: prepend, Windows `Path` reuse, absent PATH,
      no-duplicate) and managed-claude dev fallback (candidates order, cwd pin, loud skip) — green
- [x] **Live: `aionui-browser` connects** — restart on the same machine, same broken PATH node:
      `mcp server connected server=aionui-browser tools=26`, chrome-devtools-mcp process running
      under the managed runtime (`…/runtime/node/node-v24.11.0-darwin-arm64/bin/node`)
- [x] **Live: dev pin lands** — `[managed-claude] Claude Code 已钉到捆绑二进制：…/nex-work/resources/
bundled-claude/darwin-arm64/claude` (2.1.235); `GET /api/agents/2d23ff1c/overrides` shows the
      `command_override` and the untouched gateway/provenance `env_override`
- [x] Focused tests (FR-3): resolver (7 cases: strict probe semantics, version ordering, flat
      win32 layout, fallback) and migration wiring (fresh import carries resolved command, stale
      bare-node row rewritten on boot, healthy row untouched)
- [x] **Live: boot rewrite** — `[Migration] PATH \`node\` is unusable; builtin browser MCP node
      command resolved to …/runtime/node/node-v24.11.0-darwin-arm64/bin/node (source: managed)`,
`updated browser server: yes`
- [x] **Live: claude lane end to end** — a UI-faithful probe conversation spawned claude with
      `--mcp-config` carrying the absolute managed node; under the claude process: the wrapper
      alive on that node, and under it `npm exec chrome-devtools-mcp@0.16.0 --browser-url …`
- [x] **Live: stale-snapshot residual measured** — the pre-fix conversation still replays
      `command:"node"` and its MCP child dies; documented rather than silently left
- [x] Gates: format:check clean, oxlint 0 errors, `tsc --noEmit` clean

## Method, codified

The layered-falsification method that separated these defects (evidence per layer, fresh-vs-stale
clients, race-vs-state, your-path-vs-user's-path, negative-constraint tests, error text as part of
the fix) is codified as the repo `debugging` skill (`.claude/skills/debugging/SKILL.md`) so any
agent working this repo applies it by default.

## Boundaries

- Fixes **resolution**, not the broken machine: the brew node stays broken; nothing here repairs or
  hides it. Dev remains on PATH aioncore (`~/.local/bin/aioncore`) by design.
- Upstream-relevant: D1 (and `buildMcpChildEnv`) is not NexWork-specific and would fix the same
  silent failure in upstream AionUi; candidate for contribution on the next sync.

## Open item — resolved as FR-4

An assistant with empty `preferences.last_mcp_ids` (fresh install) used to send an empty snapshot,
leaving the direct-CLI claude lane with **no** MCP at all. Closed by FR-4:
`resolveEffectiveDefaultMcpIds` (pure, tested) applies the fallback, and the guid page seeds the
picker through it in a catalog-aware effect — separate from the assistant-defaults effect (whose
signature must not include the catalog, or model/permission defaults would re-apply on catalog
arrival) and value-keyed so SWR revalidations never stomp a user's manual picker changes. The
picker chip shows the seeded count, so what will be injected is visible, and unticking still wins.

A second finding from the same session, recorded for the field: with the MCP lane healthy, the
first browser tool call can still return "The in-app browser is not currently attached"
(`cdpBridge.ts`) — the single-target bridge controls only a browser tab the user can see, and no
tab was open. That is designed behavior (the agent's reply relays the fix: open the browser panel),
not a defect of this spec.

## Relationship to other specs

- Spec 002 rev 6 (version-drift notices) assumed "next start re-pins the bundled claude"; D2 is why
  that did not happen in dev. With this spec the dev machine now runs the verified 2.1.235 and the
  drift notice stops firing at its source.
