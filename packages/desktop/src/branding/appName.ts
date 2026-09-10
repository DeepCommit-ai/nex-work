/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { migrateNexworkDirectory } from '@aionui/web-host/data-directories';
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
 * Migrate the owned user-data root before Electron caches it, then apply the display name.
 * Existing data stays reachable through legacy aliases; development roots remain isolated.
 * Explicit E2E user-data overrides bypass this function at the call site.
 */
export function applyBrandAppName(app: BrandAppNameTarget, dataDirectoryName = BRAND_NAME): void {
  const currentName = dataDirectoryName.replace(/^AionUi/, BRAND_NAME);
  const previousName = currentName.replace(/^NexWork/, LEGACY_APP_DATA_DIR_NAME);
  const appData = app.getPath('appData');
  const userData = migrateNexworkDirectory(path.join(appData, previousName), path.join(appData, currentName));
  app.setPath('userData', userData);
  app.setName(BRAND_NAME);
}
