import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyBrandAppName, type BrandAppNameTarget } from '@/branding/appName';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function createFakeApp(initialName = 'AionUi') {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'nexwork-app-data-test-'));
  roots.push(appData);
  const calls: string[] = [];
  let name = initialName;
  let selected: string | undefined;
  const app: BrandAppNameTarget = {
    getPath: (key) => {
      calls.push(`getPath:${key}`);
      return key === 'appData' ? appData : (selected ?? path.join(appData, name));
    },
    setPath: (_key, value) => {
      calls.push('setPath');
      selected = value;
    },
    setName: (value) => {
      calls.push('setName');
      name = value;
    },
  };
  return { app, appData, calls, getName: () => name, getUserData: () => selected };
}

describe('NexWork application data root', () => {
  it('uses only the branded root on a fresh installation', () => {
    const fake = createFakeApp();
    applyBrandAppName(fake.app);
    expect(fake.getName()).toBe('NexWork');
    expect(fake.getUserData()).toBe(path.join(fake.appData, 'NexWork'));
    expect(fs.existsSync(path.join(fake.appData, 'AionUi'))).toBe(false);
  });
  it('moves existing data intact and keeps old absolute paths usable', () => {
    const fake = createFakeApp();
    const previous = path.join(fake.appData, 'AionUi');
    fs.mkdirSync(previous);
    fs.writeFileSync(path.join(previous, 'settings.json'), 'keep');
    applyBrandAppName(fake.app);
    expect(fs.readFileSync(path.join(fake.getUserData()!, 'settings.json'), 'utf8')).toBe('keep');
    expect(fs.realpathSync(previous)).toBe(fs.realpathSync(fake.getUserData()!));
  });
  it('pins the migrated path before applying the display name', () => {
    const fake = createFakeApp('Electron');
    applyBrandAppName(fake.app);
    expect(fake.calls.indexOf('setPath')).toBeLessThan(fake.calls.indexOf('setName'));
    expect(fake.calls).not.toContain('getPath:userData');
  });
  it.each(['NexWork-Dev', 'NexWork-Dev-2'])('keeps %s isolated from production', (name) => {
    const fake = createFakeApp();
    applyBrandAppName(fake.app, name);
    expect(fake.getUserData()).toBe(path.join(fake.appData, name));
    expect(fs.existsSync(path.join(fake.appData, 'NexWork'))).toBe(false);
  });
  it('is idempotent after migrating the legacy development root', () => {
    const fake = createFakeApp();
    const old = path.join(fake.appData, 'AionUi-Dev');
    fs.mkdirSync(old);
    applyBrandAppName(fake.app, 'NexWork-Dev');
    applyBrandAppName(fake.app, 'NexWork-Dev');
    expect(fs.realpathSync(old)).toBe(fs.realpathSync(fake.getUserData()!));
  });
  it('does not choose or overwrite either of two existing profiles', () => {
    const fake = createFakeApp();
    for (const name of ['AionUi', 'NexWork']) {
      fs.mkdirSync(path.join(fake.appData, name));
      fs.writeFileSync(path.join(fake.appData, name, 'settings'), name);
    }
    expect(() => applyBrandAppName(fake.app)).toThrow('Conflicting');
    expect(fs.readFileSync(path.join(fake.appData, 'AionUi/settings'), 'utf8')).toBe('AionUi');
    expect(fs.readFileSync(path.join(fake.appData, 'NexWork/settings'), 'utf8')).toBe('NexWork');
  });
});
