# Implementation Plan: Gateway Provisioning

**Spec**: [spec.md](spec.md) 　**Branch**: `nex-work` 　**Created**: 2026-08-26

## Approach

Reuse everything that already exists; add one surface and one provisioning routine.

Both write paths are **already declared** in `ipcBridge.ts` and need no new IPC:

- `PUT /api/agents/:id/overrides` — `ipcBridge.ts:1130`, shape `{ command_override?, env_override: {name, value}[] }`
- provider CRUD — `/api/providers/*`, already backing `AddPlatformModal`

So provisioning is a renderer-side routine that calls two existing endpoints, plus a page to drive it.
**No Rust change, no AionCore fork, no new IPC declaration.**

## Upstream-drift accounting

**Measured after implementation** (`git diff --numstat`), not estimated. Churn is over the last
90 days on this branch.

| File                                                   | Owner    | Δ actual      | 90d churn | Justification                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | -------- | ------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderer/components/layout/Router.tsx`                | upstream | **+4 / −0**   | 10        | One `React.lazy` import + one `<Route>`, matching the existing pattern; 2 of the 4 lines are `[ENTERPRISE PATCH]` markers so a future sync can find them.                                                                                       |
| `renderer/pages/settings/components/SettingsSider.tsx` | upstream | **+5 / −0**   | —         | One `BUILTIN_TAB_IDS` entry, one `builtinMap` row, one icon import, 2 marker lines. Uses `Router` icon — `LinkCloud` was already taken by the Model tab and reusing it would make two nav items indistinguishable.                              |
| `renderer/services/i18n/i18n-keys.d.ts`                | upstream | +18 / −0      | 139       | **Generated** by `node scripts/generate-i18n-types.js`. Never hand-edited.                                                                                                                                                                      |
| `renderer/services/i18n/locales/*/settings.json` × 13  | upstream | +23 / −1 each | high      | Additive `gateway` block only; the −1 is the closing-brace line. **All 13 languages translated**, not English-filled — `check-i18n` reports zero missing keys.                                                                                  |
| `specs/README.md`                                      | ours     | +1            | —         | Index row for this spec.                                                                                                                                                                                                                        |
| **`common/adapter/ipcBridge.ts`**                      | upstream | **0**         | **65**    | ⚠️ **Deliberately untouched.** Both endpoints already exist (`setAgentOverrides` at :1131, `mode.createProvider` at :1097). Editing the repo's highest-churn file for a change that does not need it would create rebase conflicts for nothing. |
| `pages/settings/AgentSettings/AgentRepairPanel.tsx`    | upstream | **0**         | 4         | Untouched. The raw env-override editor stays as the escape hatch and writes through the same API, so the two cannot disagree.                                                                                                                   |

**Total upstream code drift: 9 lines** across two files, both in low-churn areas. Everything else is
either generated or purely additive JSON.

### Ours-owned, additive

| Path                                                                            | Lines |
| ------------------------------------------------------------------------------- | ----- |
| `common/gateway/` (`types.ts`, `provisionGateway.ts`)                           | 123   |
| `renderer/pages/settings/GatewaySettings/` (`index.tsx`, `useGatewayStatus.ts`) | 286   |
| `tests/unit/gateway/`                                                           | 125   |
| `tests/integration/gatewayProvisioning.live.test.ts`                            | 73    |

Kept in new directories: `common/` already sits near the AGENTS.md limit of 10 direct children, and
opening a new top-level grouping is what that rule asks for.

## Conventions this must honour (AGENTS.md)

- **Process boundaries** — this is renderer-only; no Node API. No `process/` counterpart is needed.
- **UI** — `@arco-design/web-react` only; no bare `<button>/<input>/<select>`. Icons `@icon-park/react`.
- **CSS** — UnoCSS utilities; colours from `uno.config.ts` semantic tokens, never hardcoded.
- **TypeScript** — strict, no `any`, `type` not `interface`, aliases `@renderer/*` / `@/*`.
- **Tests** — Vitest, project target ≥80% coverage; each FR gets a test.
- **Commits** — Conventional Commit; **no AI signature** (AGENTS.md: NEVER).
- **Push** — `just push` (lint → format-check → typecheck → test → push), not `git push`.

## Deviation rationale

No upstream behaviour is reversed. This is additive: upstream has no gateway concept at all, so
there is nothing to diverge from. The raw env-override editor keeps working exactly as before.

The one judgement call worth recording for a future sync: **Gateway settings writes through the same
`overrides` API the manual editor uses**, rather than introducing a parallel store. If upstream later
adds its own gateway concept, the conflict will be a duplicated feature, not incompatible data.

## Sequencing

1. `common/gateway/types.ts` + `provisionGateway.ts` with tests — pure logic, no UI
2. `useGatewayStatus.ts` + tests — status resolution incl. the conflict state (FR-4)
3. `GatewaySettings/index.tsx` — surface
4. Router + nav registration (the only upstream edits)
5. i18n keys, then `bun run i18n:types && node scripts/check-i18n.js`
6. End-to-end against the server side — see below

## End-to-end verification (needs the server side)

Cannot be verified from this repo alone. The chain is _NexWork sends → LiteLLM records → join against
synced `tool-results/`_, and the server half lives in `cynapse:doc/spec/2026-08-26-轨迹采集-design.md`.

Joint acceptance:

1. Fresh install, enter gateway URL + key once
2. Run one aionrs conversation and one Claude Code conversation
3. Both appear in `LiteLLM_SpendLogs` — proves FR-2 provisioned every runtime
4. Trigger a >30 KB tool output in the Claude Code conversation
5. The `tool-results/` path extracted from `SpendLogs.messages` resolves to a synced file — proves the
   whole chain

Step 3 is the one that fails today, and is the reason this spec exists.
