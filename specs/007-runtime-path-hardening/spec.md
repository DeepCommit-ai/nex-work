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

## Functional Requirements

- **FR-1** The builtin browser MCP launcher must spawn `npx` with the bin directory of **the node
  runtime executing the launcher** prepended to the child PATH (`buildMcpChildEnv`), so both the
  `npx` lookup and npx's `env node` shebang resolve inside a runtime already proven to work.
  Case-variant `Path` keys (Windows) are reused, never duplicated; a missing PATH is created.
- **FR-2** Bundled-claude discovery consults candidates in order (`resolveBundledClaudeCandidates`):
  the distribution layout first, then `<cwd>/resources/bundled-claude/…` (dev repo root). A
  candidate is used only if it exists; when none does, the skip log names every path probed.
  `AIONUI_CLAUDE_BIN` still overrides everything.

## Acceptance Criteria

- [x] Focused tests: `buildMcpChildEnv` (4 cases: prepend, Windows `Path` reuse, absent PATH,
      no-duplicate) and managed-claude dev fallback (candidates order, cwd pin, loud skip) — green
- [x] **Live: `aionui-browser` connects** — restart on the same machine, same broken PATH node:
      `mcp server connected server=aionui-browser tools=26`, chrome-devtools-mcp process running
      under the managed runtime (`…/runtime/node/node-v24.11.0-darwin-arm64/bin/node`)
- [x] **Live: dev pin lands** — `[managed-claude] Claude Code 已钉到捆绑二进制：…/nex-work/resources/
    bundled-claude/darwin-arm64/claude` (2.1.235); `GET /api/agents/2d23ff1c/overrides` shows the
      `command_override` and the untouched gateway/provenance `env_override`
- [x] Gates: format:check clean, oxlint 0 errors, `tsc --noEmit` clean

## Boundaries

- Fixes **resolution**, not the broken machine: the brew node stays broken; nothing here repairs or
  hides it. Dev remains on PATH aioncore (`~/.local/bin/aioncore`) by design.
- Upstream-relevant: D1 (and `buildMcpChildEnv`) is not NexWork-specific and would fix the same
  silent failure in upstream AionUi; candidate for contribution on the next sync.

## Relationship to other specs

- Spec 002 rev 6 (version-drift notices) assumed "next start re-pins the bundled claude"; D2 is why
  that did not happen in dev. With this spec the dev machine now runs the verified 2.1.235 and the
  drift notice stops firing at its source.
