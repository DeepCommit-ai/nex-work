/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * NexWork branding layer — fork-owned ("ours") module.
 *
 * This directory does not exist upstream, so re-syncing AionUi can never
 * conflict with it. Every user-visible brand string, the brand mark and the
 * brand stylesheet live here; upstream files are touched only with one-line
 * hooks that delegate to this module.
 *
 * Placement note: this sits at `src/branding/` rather than `src/common/branding/`
 * because `src/common/` already has 11 direct children (over the 10-child limit)
 * and the ratchet rule forbids making an existing violation worse. `src/` has 7.
 * `constants.ts` and `translations.ts` are process-agnostic (no DOM, no Node) and
 * are safe to import from both the main process and the renderer; `BrandMark.tsx`
 * and `brand-override.css` are renderer-only.
 *
 * DO NOT rebrand from here — these are contracts with the external `aioncore`
 * backend binary and with already-installed user data, and changing them breaks
 * startup or orphans user data:
 *   - electron `appId: com.aionui.app`
 *   - package.json `name` / `productName` (drives `app.getName()` → userData dir)
 *   - `AIONUI_*` environment variables
 *   - `~/.aionui`, `~/.aionui-dev` data dirs, the `AionUi-Dev` log dir
 *   - the `aionui://` protocol scheme, IPC channel names, storage/config keys
 *   - GitHub owner/repo and update feed URLs
 */

/** User-visible product name. Every brand string a user reads resolves to this. */
export const BRAND_NAME = 'NexWork';

/**
 * Upstream product-name spellings found in inherited copy (locale JSON, etc.).
 * `AionUI` and `Aion UI` both occur alongside the canonical `AionUi`.
 */
export const LEGACY_BRAND_PATTERN = /Aion\s?U[Ii]/g;

/**
 * UI language a brand-new install starts in.
 *
 * This is the default for users who have never picked a language — an explicit
 * choice stored in settings always wins. It is deliberately separate from
 * `DEFAULT_LANGUAGE` (i18next's `fallbackLng`, which stays `en-US` because the
 * English locale is the complete reference bundle that fills in missing keys).
 */
export const DEFAULT_UI_LANGUAGE = 'zh-CN';

/**
 * The `<appData>/…` directory name packaged builds keep their data in.
 *
 * Deliberately still `AionUi`: it is where every existing install's config,
 * database and `~/.aionui*` symlinks already live. Renaming it would orphan
 * them. See `applyBrandAppName()` in `appName.ts`.
 */
export const LEGACY_APP_DATA_DIR_NAME = 'AionUi';

/**
 * Whether the app may check for, download, or install updates.
 *
 * OFF for now. NexWork has no distribution channel of its own yet, and the
 * updater it inherits points at upstream's feed
 * (`https://static.aionui.com/releases`, see process/services/updateFeed.ts)
 * plus upstream's GitHub releases. Leaving it on would let a packaged NexWork
 * download an upstream AionUi build and replace itself with it.
 *
 * TO RE-ENABLE once a company feed exists: point `CDN_UPDATE_BASE_URL` in
 * process/services/updateFeed.ts at that feed, set `publish` in
 * packages/desktop/electron-builder.yml to the matching target, then flip this
 * to `true`. Upstream's updater code is untouched, so nothing else is needed.
 */
export const AUTO_UPDATE_ENABLED = false;

/** Brand palette, sampled from the app icon. Consumed by `brand-override.css`. */
export const BRAND_COLOR_INK = '#1e2230';
export const BRAND_COLOR_CREAM = '#f2efe5';
