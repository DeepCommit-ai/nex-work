# Feature Specification: AionUi → NexWork Rebrand

**Feature Branch**: `nex-work`
**Created**: 2026-08-25
**Status**: Implemented (spec recorded retroactively, before the change was committed)
**Input**: "把 logo 换成这个，然后把名字也改成 NexWork，检查所有名字出现的地方…我希望整体是钩子式修改，最后加载一个 override 样式，然后还有一些配置，默认要设置成简体中文"

## Why

NexWork ships to our own staff as an internal product. It must present as our product, not as
upstream AionUi. At the same time this repo is kept in periodic sync with upstream, so the rebrand
must not become a recurring merge cost.

`aionui` appears in ~1391 tracked files. Renaming all of them would satisfy the brand goal and
destroy the sync goal. The spec therefore draws an explicit line between **brand** (what a user
reads) and **contract** (what a machine depends on), and only the former changes.

## User Scenarios

1. A staff member launches the app and sees the NexWork icon in the Dock/taskbar, "NexWork" in the
   window title, About dialog, tray and native menus, and no reference to AionUi anywhere they can
   reach in the UI.
2. A staff member installs the app for the first time and the interface is already in Simplified
   Chinese without them changing anything.
3. A staff member who has previously chosen a language keeps that language, including if they chose
   English.
4. An existing user who upgrades keeps every conversation, setting and credential — the rebrand must
   not orphan user data.

## Functional Requirements

- **FR-1** All user-visible occurrences of the product name display as "NexWork".
- **FR-2** Application icons on macOS, Windows, Linux and PWA are the NexWork mark.
- **FR-3** The UI defaults to `zh-CN` for users who have never chosen a language. An explicit prior
  choice always wins, **including an explicit choice of `en-US`**.
- **FR-4** English remains the i18n fallback bundle, so a key missing from another locale still
  renders text rather than a raw key.
- **FR-5** User data location is unchanged by the rebrand. No user loses conversations or settings.
- **FR-6** Identifiers that other systems depend on are unchanged (see Non-Goals).
- **FR-7** A brand override stylesheet is loaded last, so brand styling wins on source order without
  editing upstream stylesheets.

## Non-Goals — deliberately NOT renamed

These are contracts, not branding. Renaming any of them either breaks the external `aioncore`
backend binary, orphans user data, or creates merge conflicts for zero user-visible gain:

| Kept                                                                                                                                                       | Reason                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `appId: com.aionui.app`                                                                                                                                    | Orphans user data and code-signing identity                                                                                        |
| `AIONUI_*` env vars (296 refs)                                                                                                                             | Contract with the external aioncore binary                                                                                         |
| `~/.aionui*` data dirs, `AionUi-Dev` log dir                                                                                                               | Same; aioncore is handed these as `--data-dir` / `--log-dir`                                                                       |
| `aionui://` URL scheme                                                                                                                                     | OS-registered protocol handler                                                                                                     |
| `package.json` `name` / `productName`                                                                                                                      | Drives `app.getName()` → `userData`. Keeping it is what preserves data                                                             |
| IPC channels, localStorage/config keys, DB filenames, `source IN ('aionui')` CHECK constraints, `_aionui_` wire markers                                    | Persisted or cross-process contracts                                                                                               |
| `.aionui-markdown` CSS namespace (78 refs)                                                                                                                 | User-theme contract                                                                                                                |
| `[AionUi]` log prefixes (95)                                                                                                                               | Parsed by `scripts/benchmark-startup.ts`                                                                                           |
| `@aionui/*` workspace names                                                                                                                                | npm workspace identity                                                                                                             |
| 649 `Copyright 20xx AionUi (aionui.com)` headers                                                                                                           | Attribution, not brand chrome                                                                                                      |
| `iOfficeAI/AionUi` issue URLs, `static.aionui.com` update feed                                                                                             | Point at upstream, which is correct                                                                                                |
| `X-Title`, `DEFAULT_USER_AGENT`, in-app browser UA, MCP names (`aionui-browser`, `aionui_image_generation`), install script banners, systemd `Description` | Decided out of scope; MCP names in particular are simultaneously UI labels, model-facing tool namespaces and persisted config keys |

## Key Decisions

- **D-1 — Locale JSON is never edited.** A runtime rewriter hooks the i18n _load_ path in both
  processes and rewrites `AionUi`/`AionUI`/`Aion UI` in translation _values_. All 91 locale files
  stay byte-identical to upstream, and brand strings upstream adds later are rebranded automatically
  instead of silently reintroducing "AionUi". Keys are never rewritten.
- **D-2 — `productName` in `electron-builder.yml` changes; `package.json`'s does not.** They are
  separate: the former is what users see on the installed app, the latter drives `userData`.
- **D-3 — `app.setName('NexWork')` is paired with an explicit `userData` pin.** The pin derives from
  `appData` (the parent Electron itself derives `userData` from) rather than from the current
  `userData` value, so it does not depend on what the name happens to be at call time. It runs only
  when `app.isPackaged`; dev pins its own path already.
- **D-4 — `executableName` changes, with fallbacks.** Launchers and e2e fixtures try `NexWork*`
  first and fall back to `AionUi*` so a pre-rename local build still launches during the transition.
- **D-5 — Packaged log directory moves** to `~/Library/Logs/NexWork` as a consequence of D-3. Logs
  are not user data, all readers go through `getLogsDir()`, and aioncore is handed an explicit
  `--log-dir`. Accepted; revisit if prod log continuity matters.

## Acceptance Criteria

- [x] `tsc --noEmit`, `lint`, `format:check`, `check-i18n` all pass
- [x] Full test suite passes (521 files / 4967 tests)
- [x] All 91 locale files byte-identical to upstream
- [x] After restart, `Application Support` contains only `AionUi-Dev` — no `NexWork-Dev` directory
- [x] aioncore relaunches with byte-identical `--data-dir` / `--log-dir` / `--work-dir` args
- [x] Packaged-path probe against the real Electron binary confirms `setName` does not disturb an
      explicit `setPath` override (`PIN_HELD=true`), and `path.join(appData,'AionUi')` reproduces the
      default `userData` exactly
- [ ] **Not verified:** visual confirmation of `brand-override.css` in a live window (no screen-recording
      permission on the dev machine)
- [ ] **Not verified:** Windows and Linux packaging paths — the `.nsh` copy and `.desktop`/deb metadata
      are static-only changes, unbuildable on this machine

## Open Items

- **OI-1** `ChannelConflictWarning.tsx` is unreachable dead code (no importer, no barrel, no test) with
  ~19 hardcoded English strings. i18n-migrating it would add 19 keys × 13 locales = 247 entries to
  upstream-owned JSON for a component no user can reach. Left unchanged pending a decision: delete it,
  or wire it up first and then migrate.
