/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { BRAND_NAME, LEGACY_APP_DATA_DIR_NAME } from './constants';

/**
 * The slice of Electron's `app` this needs. Structural so it can be unit-tested
 * without an Electron runtime.
 */
export type BrandAppNameTarget = {
  getPath: (name: 'appData' | 'userData') => string;
  setPath: (name: 'userData', value: string) => void;
  setName: (name: string) => void;
};

/**
 * Renames the Electron app to NexWork **without moving the user's data.**
 *
 * Electron derives `app.getPath('userData')` from `app.getName()`, so calling
 * `setName('NexWork')` on its own would silently relocate userData from
 * `<appData>/AionUi` to `<appData>/NexWork` — orphaning the config, the local
 * database, and the `~/.aionui` / `~/.aionui-config` symlinks that are built on
 * top of it (see `getDataPath()` / `getConfigPath()` in process/utils/utils.ts).
 * So userData is pinned to the legacy directory *first*, and only then is the
 * name changed; `setPath` registers an explicit override that a later `setName`
 * does not disturb.
 *
 * `appData` is used rather than `path.dirname(getPath('userData'))` because it is
 * the parent Electron itself derives userData from, so the pin does not depend on
 * what the name happens to be at call time. It matches the literal
 * `<appData>/AionUi` that `installerLastFailure.ts` already writes to.
 *
 * WHY IT IS SAFE TO CALL THIS ONLY IN PACKAGED BUILDS: dev and E2E already pin
 * userData themselves (`AionUi-Dev` via `getDevAppName()`, or the E2E sandbox
 * dir), and those names are contracts of their own — the dev log directory
 * `~/Library/Logs/AionUi-Dev` is read by the startup benchmarks. Renaming there
 * would break dev isolation for no user-visible gain, since no user sees a dev
 * build's menu bar.
 *
 * ORDERING: must run before ANY other `app.getPath('userData')` call, because
 * Electron caches the resolved path on first use. `configureChromium.ts` is the
 * first import in `src/index.ts` precisely so this window exists.
 *
 * Known, intended side effect: on macOS `app.getPath('logs')` follows the app
 * name, so packaged builds now log to `~/Library/Logs/NexWork` instead of
 * `~/Library/Logs/AionUi`. Logs are diagnostic, not user data. In-app readers
 * go through `getLogsDir()` and follow automatically; the two out-of-app
 * readers that hardcode the directory — `scripts/benchmark-startup.ts` and
 * `scripts/benchmark-acp-startup.ts` — were updated to try `NexWork` too, and
 * any new external reader must do the same.
 */
export function applyBrandAppName(app: BrandAppNameTarget): void {
  app.setPath('userData', path.join(app.getPath('appData'), LEGACY_APP_DATA_DIR_NAME));
  app.setName(BRAND_NAME);
}
