/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { describe, expect, it } from 'vitest';
import { applyBrandAppName, type BrandAppNameTarget } from '@/branding/appName';
import { BRAND_NAME, LEGACY_APP_DATA_DIR_NAME } from '@/branding';

const APP_DATA = path.join('/Users/tester', 'Library', 'Application Support');

/** Fake Electron `app` that models the bit that matters: name drives userData. */
function createFakeApp(initialName = 'AionUi') {
  const calls: string[] = [];
  let name = initialName;
  let userDataOverride: string | null = null;

  const app: BrandAppNameTarget = {
    getPath: (which) => {
      calls.push(`getPath:${which}`);
      if (which === 'appData') return APP_DATA;
      return userDataOverride ?? path.join(APP_DATA, name);
    },
    setPath: (which, value) => {
      calls.push(`setPath:${which}`);
      userDataOverride = value;
    },
    setName: (next) => {
      calls.push('setName');
      name = next;
    },
  };

  return { app, calls, getName: () => name, getUserData: () => app.getPath('userData') };
}

describe('applyBrandAppName', () => {
  it('renames the app to the brand name', () => {
    const fake = createFakeApp();
    applyBrandAppName(fake.app);
    expect(fake.getName()).toBe(BRAND_NAME);
  });

  it('leaves user data in the legacy directory after the rename', () => {
    // This is the whole point: without the pin, Electron would resolve userData
    // to <appData>/NexWork and orphan every existing install's database.
    const fake = createFakeApp();
    applyBrandAppName(fake.app);
    expect(fake.getUserData()).toBe(path.join(APP_DATA, 'AionUi'));
    expect(fake.getUserData()).not.toContain(BRAND_NAME);
  });

  it('pins the path before renaming, never after', () => {
    // Reversed order would let Electron cache <appData>/NexWork in between.
    const fake = createFakeApp();
    applyBrandAppName(fake.app);
    expect(fake.calls.indexOf('setPath:userData')).toBeLessThan(fake.calls.indexOf('setName'));
  });

  it('derives the pin from appData, not from the name it is about to replace', () => {
    // A build whose name was already changed elsewhere must still land on the
    // legacy dir, so the pin must not read the current userData path.
    const fake = createFakeApp('SomethingElse');
    applyBrandAppName(fake.app);
    const callsDuringApply = [...fake.calls];
    expect(fake.getUserData()).toBe(path.join(APP_DATA, 'AionUi'));
    expect(callsDuringApply).not.toContain('getPath:userData');
  });

  it('is idempotent, so a second call cannot drift the data directory', () => {
    const fake = createFakeApp();
    applyBrandAppName(fake.app);
    const afterFirst = fake.getUserData();
    applyBrandAppName(fake.app);
    expect(fake.getUserData()).toBe(afterFirst);
  });

  it('keeps the legacy directory name that installerLastFailure already writes to', () => {
    // process/services/installerLastFailure.ts hardcodes <appData>/AionUi; if
    // these two ever disagree the installer would report into a dead directory.
    expect(LEGACY_APP_DATA_DIR_NAME).toBe('AionUi');
  });
});
