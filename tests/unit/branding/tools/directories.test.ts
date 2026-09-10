import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrateNexworkDirectory, resolveNexworkWebDirectory } from '@aionui/web-host/data-directories';

const roots: string[] = [];
const temporary = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexwork-paths-test-'));
  roots.push(root);
  return root;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('owned directory migration', () => {
  it('recreates a reset NexWork directory behind its owned compatibility link', () => {
    const root = temporary();
    const old = path.join(root, 'old');
    const current = path.join(root, 'new');
    fs.symlinkSync(current, old, process.platform === 'win32' ? 'junction' : 'dir');
    expect(migrateNexworkDirectory(old, current)).toBe(current);
    expect(fs.realpathSync(old)).toBe(fs.realpathSync(current));
  });
  it('does not create the target of an unrelated dangling legacy link', () => {
    const root = temporary();
    const old = path.join(root, 'old');
    const unrelated = path.join(root, 'unrelated');
    fs.symlinkSync(unrelated, old, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => migrateNexworkDirectory(old, path.join(root, 'new'))).toThrow();
    expect(fs.existsSync(unrelated)).toBe(false);
  });

  it('keeps nested data and existing absolute paths reachable', () => {
    const root = temporary();
    const oldRoot = path.join(root, 'AionUi-Dev');
    const current = path.join(root, 'NexWork-Dev');
    fs.mkdirSync(path.join(oldRoot, 'aionui'), { recursive: true });
    fs.writeFileSync(path.join(oldRoot, 'aionui/history'), 'history');
    migrateNexworkDirectory(oldRoot, current);
    migrateNexworkDirectory(path.join(current, 'aionui'), path.join(current, 'nexwork'));
    expect(fs.readFileSync(path.join(current, 'nexwork/history'), 'utf8')).toBe('history');
    expect(fs.readFileSync(path.join(oldRoot, 'aionui/history'), 'utf8')).toBe('history');
  });
  it('accepts an empty target created by Electron before initialization', () => {
    const root = temporary(),
      old = path.join(root, 'old'),
      current = path.join(root, 'new');
    fs.mkdirSync(old);
    fs.mkdirSync(current);
    fs.writeFileSync(path.join(old, 'data'), 'keep');
    migrateNexworkDirectory(old, current);
    expect(fs.readFileSync(path.join(current, 'data'), 'utf8')).toBe('keep');
  });
  it('restores the source when a compatibility link cannot be created', () => {
    const root = temporary(),
      old = path.join(root, 'old'),
      current = path.join(root, 'new');
    fs.mkdirSync(old);
    fs.writeFileSync(path.join(old, 'data'), 'keep');
    vi.spyOn(fs, 'symlinkSync').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => migrateNexworkDirectory(old, current)).toThrow('blocked');
    expect(fs.readFileSync(path.join(old, 'data'), 'utf8')).toBe('keep');
    expect(fs.existsSync(current)).toBe(false);
  });
  it('does not replace a file blocking the new directory', () => {
    const root = temporary(),
      old = path.join(root, 'old'),
      current = path.join(root, 'new');
    fs.mkdirSync(old);
    fs.writeFileSync(current, 'user file');
    expect(() => migrateNexworkDirectory(old, current)).toThrow('Conflicting');
    expect(fs.readFileSync(current, 'utf8')).toBe('user file');
  });
  it('preserves a dangling link at the destination instead of overwriting it', () => {
    const root = temporary(),
      old = path.join(root, 'old'),
      current = path.join(root, 'new');
    fs.mkdirSync(old);
    const target = path.join(root, 'missing');
    fs.symlinkSync(target, current, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => migrateNexworkDirectory(old, current)).toThrow('Conflicting');
    expect(fs.readlinkSync(current)).toContain('missing');
    expect(fs.lstatSync(old).isDirectory()).toBe(true);
  });
});

describe('standalone web directories', () => {
  it.each([
    [true, false, '.nexwork-web'],
    [false, false, '.nexwork-web-dev'],
    [false, true, '.nexwork-web-dev-2'],
  ] as const)('isolates production=%s and secondary=%s', (production, multiInstance, name) => {
    const home = temporary();
    expect(resolveNexworkWebDirectory({ home, production, multiInstance })).toBe(path.join(home, name));
  });
  it('migrates the former default with a readable historical alias', () => {
    const home = temporary(),
      previous = path.join(home, '.aionui-web-dev');
    fs.mkdirSync(previous);
    fs.writeFileSync(path.join(previous, 'database'), 'keep');
    const selected = resolveNexworkWebDirectory({ home });
    expect(fs.readFileSync(path.join(selected, 'database'), 'utf8')).toBe('keep');
    expect(fs.realpathSync(previous)).toBe(fs.realpathSync(selected));
  });
  it('preserves explicit custom paths even when a default profile exists', () => {
    const home = temporary(),
      old = path.join(home, '.aionui-web-dev'),
      override = path.join(home, 'my-project');
    fs.mkdirSync(old);
    expect(resolveNexworkWebDirectory({ home, override })).toBe(override);
    expect(fs.lstatSync(old).isSymbolicLink()).toBe(false);
  });
});
