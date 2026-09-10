import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateNexworkDirectory } from '@aionui/web-host/data-directories';
import { getConfigPath, getDataPath, getTempPath, resolveCliSafePath } from '@process/utils/utils';

const state = vi.hoisted(() => ({ root: '', packaged: false, links: true }));
vi.mock('@/common/platform', () => ({
  getPlatformServices: () => ({
    paths: {
      getHomeDir: () => state.root,
      getDataDir: () => `${state.root}/Application Support/NexWork-Dev`,
      getTempDir: () => `${state.root}/temp`,
      isPackaged: () => state.packaged,
      needsCliSafeSymlinks: () => state.links,
    },
  }),
}));

beforeEach(() => {
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexwork-directory-paths-'));
  state.packaged = false;
  state.links = true;
  vi.stubEnv('AIONUI_MULTI_INSTANCE', '0');
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(state.root, { recursive: true, force: true });
});

describe('product paths', () => {
  it.each([
    [false, '0', '-dev'],
    [false, '1', '-dev-2'],
    [true, '1', ''],
  ] as const)('separates packaged=%s and secondary=%s', (packaged, multi, suffix) => {
    state.packaged = packaged;
    vi.stubEnv('AIONUI_MULTI_INSTANCE', multi);
    expect(getDataPath()).toBe(path.join(state.root, `.nexwork${suffix}`));
    expect(getConfigPath()).toBe(path.join(state.root, `.nexwork-config${suffix}`));
    expect(getTempPath()).toBe(path.join(state.root, 'temp/nexwork'));
  });

  it('resolves saved legacy defaults to branded paths and retains history references', () => {
    const oldRoot = path.join(state.root, 'Application Support/AionUi-Dev');
    const newRoot = path.join(state.root, 'Application Support/NexWork-Dev');
    fs.mkdirSync(path.join(oldRoot, 'aionui'), { recursive: true });
    fs.mkdirSync(path.join(oldRoot, 'config'));
    fs.writeFileSync(path.join(oldRoot, 'aionui/history'), 'keep');
    const oldWork = path.join(state.root, '.aionui-dev');
    const oldConfig = path.join(state.root, '.aionui-config-dev');
    fs.symlinkSync(path.join(oldRoot, 'aionui'), oldWork, process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(path.join(oldRoot, 'config'), oldConfig, process.platform === 'win32' ? 'junction' : 'dir');
    migrateNexworkDirectory(oldRoot, newRoot);
    const work = getDataPath(),
      config = getConfigPath();
    expect(resolveCliSafePath(oldWork, work)).toBe(work);
    expect(resolveCliSafePath(path.join(oldRoot, 'aionui'), work)).toBe(work);
    expect(resolveCliSafePath(oldConfig, config)).toBe(config);
    expect(fs.readFileSync(path.join(oldWork, 'history'), 'utf8')).toBe('keep');
  });

  it('keeps a custom workspace path unchanged', () => {
    const custom = path.join(state.root, 'my-files');
    fs.mkdirSync(custom);
    expect(resolveCliSafePath(custom, getDataPath())).toBe(custom);
  });

  it('preserves a user file that blocks the preferred alias', () => {
    const alias = path.join(state.root, '.nexwork-dev');
    fs.writeFileSync(alias, 'user data');
    expect(getDataPath()).toBe(path.join(state.root, 'Application Support/NexWork-Dev/nexwork'));
    expect(fs.readFileSync(alias, 'utf8')).toBe('user data');
  });

  it('does not redirect an alias belonging to a different profile', () => {
    const alias = path.join(state.root, '.nexwork-dev');
    const custom = path.join(state.root, 'custom');
    fs.mkdirSync(custom);
    fs.symlinkSync(custom, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(getDataPath()).toBe(path.join(state.root, 'Application Support/NexWork-Dev/nexwork'));
    expect(fs.realpathSync(alias)).toBe(fs.realpathSync(custom));
  });

  it('uses branded physical directories when CLI aliases are not needed', () => {
    state.links = false;
    expect(getDataPath()).toBe(path.join(state.root, 'Application Support/NexWork-Dev/nexwork'));
    expect(getConfigPath()).toBe(path.join(state.root, 'Application Support/NexWork-Dev/config'));
    expect(fs.existsSync(path.join(state.root, '.nexwork-dev'))).toBe(false);
  });
});
