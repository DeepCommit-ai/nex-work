import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const {
  preparePythonPackages,
  verifyPythonPackages,
  extractWheel,
} = require('../../../packages/shared-scripts/src/prepare-python-packages');
const wheel = Buffer.from(
  'UEsDBBQAAAAAANJ7WV02PFL3DAAAAAwAAAATAAAAZml4dHVyZS9fX2luaXRfXy5weXZlcnNpb24gPSAxClBLAQIUABQAAAAAANJ7WV02PFL3DAAAAAwAAAATAAAAAAAAAAAAAACAAQAAAABmaXh0dXJlL19faW5pdF9fLnB5UEsFBgAAAAABAAEAQQAAAD0AAAAAAA==',
  'base64'
);
const roots: string[] = [];
const temporary = () => {
  const root = mkdtempSync(join(tmpdir(), 'python-packages-'));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()))) throw new Error('Unexpected temporary root');
    rmSync(root, { recursive: true, force: true });
  }
});
const setup = (platform = 'win32') => {
  const projectRoot = temporary();
  const bundle = join(projectRoot, 'resources/bundled-python', `${platform}-fixture`);
  mkdirSync(join(bundle, 'bin'), { recursive: true });
  writeFileSync(join(bundle, platform === 'win32' ? 'python.exe' : 'bin/python3'), 'test interpreter');
  const pin = {
    version: '3.12.15',
    packages: [
      {
        name: 'fixture',
        module: 'fixture',
        version: '1',
        url: 'https://example.test/fixture-none-any.whl',
        sha256: createHash('sha256').update(wheel).digest('hex'),
      },
    ],
  };
  return {
    projectRoot,
    bundle,
    pin,
    options: { projectRoot, platform, arch: 'fixture', pin, download: async () => wheel },
  };
};

describe('offline Python export dependencies', () => {
  it.each(['win32', 'darwin', 'linux'])(
    'stages verified pure wheels with relocatable imports for %s',
    async (platform) => {
      const f = setup(platform);
      await preparePythonPackages(f.options);
      expect(verifyPythonPackages(f.bundle, f.pin, platform).files['fixture/__init__.py']).toBeDefined();
      expect(readFileSync(join(f.bundle, 'nexwork-packages/fixture/__init__.py'), 'utf8')).toBe('version = 1\n');
      await expect(
        preparePythonPackages({
          ...f.options,
          download: async () => {
            throw new Error('offline');
          },
        })
      ).resolves.toBeUndefined();
    }
  );
  it('fails on a modified dependency and refuses a replacement with a wrong hash', async () => {
    const f = setup();
    await preparePythonPackages(f.options);
    writeFileSync(join(f.bundle, 'nexwork-packages/fixture/__init__.py'), 'modified');
    expect(() => verifyPythonPackages(f.bundle, f.pin, 'win32')).toThrow('differs');
    await expect(preparePythonPackages({ ...f.options, download: async () => Buffer.from('corrupt') })).rejects.toThrow(
      'SHA-256'
    );
  });
  it('does not claim a successful build when the dependency download fails', async () => {
    const f = setup();
    await expect(
      preparePythonPackages({
        ...f.options,
        download: async () => {
          throw new Error('offline');
        },
      })
    ).rejects.toThrow('offline');
    expect(existsSync(join(f.bundle, 'nexwork-packages/PACKAGES.json'))).toBe(false);
  });
  it('rejects a wheel path that escapes its staging directory', async () => {
    const root = temporary();
    const unsafe = Buffer.from(
      'UEsDBBQAAAAAANJ7WV02PFL3DAAAAAwAAAAMAAAALi4vZXNjYXBlLnB5dmVyc2lvbiA9IDEKUEsBAhQAFAAAAAAA0ntZXTY8UvcMAAAADAAAAAwAAAAAAAAAAAAAAIABAAAAAC4uL2VzY2FwZS5weVBLBQYAAAAAAQABADoAAAA2AAAAAAA=',
      'base64'
    );
    await expect(extractWheel(unsafe, root)).rejects.toThrow();
    expect(existsSync(join(root, 'escape.py'))).toBe(false);
  });
});
