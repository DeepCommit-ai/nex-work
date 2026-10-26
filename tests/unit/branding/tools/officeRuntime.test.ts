import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { officeRuntimeEnvironment } from '@/branding/tools/officeRuntime';

const require = createRequire(import.meta.url);
const { prepareOfficecli, verifyOfficecli } = require('../../../../packages/shared-scripts/src/prepare-officecli.js');
const roots: string[] = [];
const bytes = Buffer.from('test-only executable');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const pin = { version: '1.2.3', assets: { 'win32-x64': { name: 'officecli-win-x64.exe', sha256 } } };
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'office-runtime-'));
  roots.push(root);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ bundledOffice: pin }));
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('bundled Office preview runtime', () => {
  it('downloads a pinned version, retries the official origin, and reuses verified offline bytes', async () => {
    const root = fixture();
    const urls: string[] = [];
    const fetchBytes = async (url: string) => {
      urls.push(url);
      if (urls.length === 1) throw new Error('offline mirror');
      return bytes;
    };
    await prepareOfficecli({ projectRoot: root, platform: 'win32', arch: 'x64', fetchBytes });
    await prepareOfficecli({ projectRoot: root, platform: 'win32', arch: 'x64', fetchBytes });
    expect(urls).toEqual([
      'https://d.officecli.ai/releases/download/v1.2.3/officecli-win-x64.exe',
      'https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.2.3/officecli-win-x64.exe',
    ]);
  });
  it('rejects corrupt downloads instead of installing or executing them', async () => {
    await expect(
      prepareOfficecli({
        projectRoot: fixture(),
        platform: 'win32',
        arch: 'x64',
        fetchBytes: async () => Buffer.from('bad'),
      })
    ).rejects.toThrow('Cannot prepare');
  });
  it('prepends only the child process PATH, including mixed-case Windows keys', async () => {
    const root = fixture();
    const file = await prepareOfficecli({
      projectRoot: root,
      platform: 'win32',
      arch: 'x64',
      fetchBytes: async () => bytes,
    });
    const env = { Path: 'C:/system', KEEP: 'value' };
    expect(officeRuntimeEnvironment(path.join(root, 'resources'), pin, 'win32', 'x64', env)).toEqual({
      Path: path.dirname(file) + ';C:/system',
    });
    expect(env).toEqual({ Path: 'C:/system', KEEP: 'value' });
  });
  it('fails closed when a packaged binary is missing or has been replaced', async () => {
    const root = fixture();
    expect(() => officeRuntimeEnvironment(root, pin, 'win32', 'x64')).toThrow();
    const file = await prepareOfficecli({
      projectRoot: root,
      platform: 'win32',
      arch: 'x64',
      fetchBytes: async () => bytes,
    });
    writeFileSync(file, 'changed');
    expect(() => verifyOfficecli(path.dirname(file), pin, 'win32', 'x64')).toThrow('checksum');
    expect(() => officeRuntimeEnvironment(path.join(root, 'resources'), pin, 'win32', 'x64')).toThrow('checksum');
  });
  it('allows an unprepared development checkout without masking a corrupt existing bundle', () => {
    const root = fixture();
    expect(officeRuntimeEnvironment(root, pin, 'win32', 'x64', {}, false)).toEqual({});
    const dir = path.join(root, 'bundled-officecli', 'win32-x64');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'officecli.exe'), 'bad');
    expect(() => officeRuntimeEnvironment(root, pin, 'win32', 'x64', {}, false)).toThrow('checksum');
  });
});
