# Implementation Plan: AionUi → NexWork Rebrand

**Spec**: [spec.md](spec.md) · **Status**: Implemented

## Approach

A single ours-owned branding module supplies every brand value; upstream files are touched only
enough to delegate to it. Nothing about the brand is spelled as a literal in an upstream file.

### New, ours-owned (no drift)

```
packages/desktop/src/branding/
  index.ts            process-safe barrel
  constants.ts        BRAND_NAME, DEFAULT_UI_LANGUAGE, …
  translations.ts     applyBrandToTranslations() — runtime locale rewriter
  language.ts         resolveInitialLanguage(stored)
  appName.ts          applyBrandAppName() — setName + userData pin
  BrandMark.tsx       the brand glyph, lifted out of Layout.tsx
  brand-override.css  loaded LAST in main.tsx
tests/unit/branding/  4 files
```

`src/` goes 7 → 8 direct children, within the ≤10 limit. `common/` was avoided — it already sits at
11 and using it would have worsened an existing ratchet violation.

### Hook points

| Hook             | Mechanism                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Stylesheet       | `brand-override.css` imported last in `main.tsx` — one line                                       |
| i18n strings     | `applyBrandToTranslations()` wraps the locale **load** path in both processes                     |
| Language default | `resolveInitialLanguage(stored)` replaces the `navigator.language` / `DEFAULT_LANGUAGE` fallbacks |
| App name         | `applyBrandAppName()` called as the first import in `src/index.ts`, before any `getPath`          |
| Brand glyph      | `<BrandMark/>` replaces an inline `<svg>` in `Layout.tsx`                                         |

## Upstream-drift accounting

**36 text files, +201/−167**, plus 9 icon binaries. 12 of the 36 are exactly 2 lines
(one import + one call site).

| File                                                                                             | Δ       |
| ------------------------------------------------------------------------------------------------ | ------- |
| `.github/workflows/pr-checks.yml`                                                                | +4/−4   |
| `homebrew/aionui.rb.example`                                                                     | +1/−1   |
| `packages/desktop/electron-builder.yml`                                                          | +8/−8   |
| `packages/desktop/src/process/services/i18n/index.ts`                                            | +4/−3   |
| `packages/desktop/src/process/utils/configureChromium.ts`                                        | +5/−0   |
| `packages/desktop/src/process/utils/tray.ts`                                                     | +2/−1   |
| `packages/desktop/src/renderer/components/layout/DocumentTitle.tsx`                              | +2/−1   |
| `packages/desktop/src/renderer/components/layout/Layout.tsx`                                     | +6/−21  |
| `packages/desktop/src/renderer/components/layout/Titlebar/index.tsx`                             | +2/−1   |
| `packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx` | +2/−1   |
| `packages/desktop/src/renderer/hooks/system/notification/useBrowserNotification.ts`              | +2/−1   |
| `packages/desktop/src/renderer/hooks/system/notification/useDesktopTurnNotification.ts`          | +2/−1   |
| `packages/desktop/src/renderer/index.html`                                                       | +3/−3   |
| `packages/desktop/src/renderer/main.tsx`                                                         | +2/−0   |
| `packages/desktop/src/renderer/services/i18n/index.ts`                                           | +5/−4   |
| `public/manifest.webmanifest`                                                                    | +3/−3   |
| `resources/windows/installer-messages.nsh`                                                       | +49/−49 |
| `resources/windows/installer-observability.nsh`                                                  | +5/−5   |
| `resources/windows/installer-process-control.nsh`                                                | +3/−3   |
| `resources/windows/installer-remove-registry.nsh`                                                | +1/−1   |
| `resources/windows/installer-repair-heal.nsh`                                                    | +2/−2   |
| `resources/windows/installer-update-verify.nsh`                                                  | +1/−1   |
| `resources/windows/support/query-lockers.ps1`                                                    | +3/−3   |
| `resources/windows/support/report-installer-failure.ps1`                                         | +5/−5   |
| `scripts/build-with-builder.js`                                                                  | +5/−5   |
| `scripts/dev-bootstrap.mjs`                                                                      | +4/−4   |
| `scripts/packaged-launch.mjs`                                                                    | +11/−7  |
| `scripts/smoke-installer-failure-messagebox.js`                                                  | +15/−2  |
| `scripts/smoke-installer-report.ps1`                                                             | +13/−4  |
| `scripts/smoke-installer-rstrtmgr-ui.js`                                                         | +2/−2   |
| `scripts/smoke-installer-self-lock.js`                                                           | +2/−2   |
| `tests/e2e/fixtures.ts`                                                                          | +13/−9  |
| `tests/unit/bootstrap/buildWithBuilder.test.ts`                                                  | +2/−1   |
| `tests/unit/renderer/documentTitle.dom.test.tsx`                                                 | +7/−6   |
| `tests/unit/renderer/layout/LayoutSiderBrandHome.dom.test.tsx`                                   | +3/−2   |
| `tests/unit/renderer/useDesktopTurnNotification.dom.test.tsx`                                    | +2/−1   |

**Binaries replaced** (originals kept at `resources/aionui-brand-backup/*.aionui.bak`, covered by the
existing `*.bak` rule in `.gitignore`):
`resources/{app.icns,app.ico,app.png,app_dev.png,icon.png}`,
`public/pwa/icon-{180,192,512}.png`,
`packages/desktop/src/renderer/assets/logos/brand/app.png`.

### Justification for anything over ~2 lines

- **`installer-messages.nsh` +49/−49** — one line per bilingual installer string value. Irreducible;
  every line is a distinct user-facing message. The other ~500 `AionUi`/`AIONUI` occurrences in the
  `.nsh` tree are macro names, NSIS variables, a PowerShell type namespace, function names and temp
  filenames, and were classified programmatically before anything was touched.
- **`Layout.tsx` +6/−21** — the −21 is upstream's hardcoded inline logo SVG, now `BrandMark.tsx`.
- **`electron-builder.yml` +8/−8** — `productName`, `executableName`, `copyright`, protocol display
  name, deb `maintainer`/`vendor`, `.desktop` `Name`/`Icon`. Each a distinct packaging field.
- **`packaged-launch.mjs` +11/−7`, `tests/e2e/fixtures.ts` +13/−9`** — extended existing candidate-list
  shapes to try `NexWork*` then fall back to `AionUi*`, rather than hard-renaming, so a pre-rename
  local build still launches.
- **`smoke-installer-report.ps1` +13/−4`, `smoke-installer-failure-messagebox.js` +15/−2`** — these
  asserted on literal brand copy. They now parse `productName` out of `electron-builder.yml`, the same
  source electron-builder stamps onto the installer, and fail loudly if they cannot. Brand-agnostic
  rather than re-pinned to a new literal.
- **`configureChromium.ts` +5/−0`** — the `setName` + userData pin. The highest-risk item in the change
  is also the smallest upstream diff.
- **4 test files** — asserted the literal `'AionUi'`. Repointed at `BRAND_NAME` so they are
  brand-agnostic.

### Zero-drift surfaces, deliberately

- **91 locale JSON files**: untouched, rebranded at load time (spec D-1).
- **`appMenu.ts`**: a round-1 `label: BRAND_NAME` edit was reverted — with `setName` in place,
  `app.name` already resolves correctly in both packaged and dev builds. One fewer upstream file.

## Verification

`tsc --noEmit` 0 · `lint` 0 errors (913 pre-existing warnings) · `format:check` 0 ·
`i18n:types` up to date · `check-i18n` passed · `bun run test` **521 files / 4967 tests passed**,
1 file / 5 skipped, 0 failures.

Runtime: dev app restarted, `Main window created` / `Renderer did-finish-load` / `AIONCORE_LISTENING`,
aioncore relaunched with byte-identical args, no `NexWork*` directory anywhere on disk.
Packaged path probed directly against the repo's Electron binary: `PIN_HELD=true`, `APPDATA_STABLE=true`.

**Unverified:** `brand-override.css` visual result (no screen-recording permission); Windows/Linux
packaging output (not buildable on this machine).
