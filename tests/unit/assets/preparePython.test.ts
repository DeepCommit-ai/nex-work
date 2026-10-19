import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const {
  PYTHON_TRIPLES,
  preparePython,
  pythonAssetName,
  resolvePythonPin,
} = require('../../../packages/shared-scripts/src/prepare-python');

const repoRoot = resolve(__dirname, '../../..');
const dirs: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'prepare-python-test-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeFile(filePath: string, content = '') {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, { mode: 0o755 });
}

/** A python-build-standalone-shaped archive for linux: top-level python/ with bin, lib and extras to prune. */
function makeArchive() {
  const work = tmp();
  const root = join(work, 'python');
  writeFile(join(root, 'bin', 'python3'), '#!/bin/sh\nexit 0\n');
  writeFile(join(root, 'bin', 'pip3'));
  writeFile(join(root, 'bin', 'python3.12-config'));
  writeFile(join(root, 'include', 'python3.12', 'Python.h'));
  writeFile(join(root, 'share', 'man', 'python3.1'));
  writeFile(join(root, 'lib', 'libpython3.12.so'));
  writeFile(join(root, 'lib', 'libtcl9.0.so'));
  writeFile(join(root, 'lib', 'tk9.0', 'tk.tcl'));
  writeFile(join(root, 'lib', 'python3.12', 'json', '__init__.py'));
  writeFile(join(root, 'lib', 'python3.12', 'tkinter', '__init__.py'));
  writeFile(join(root, 'lib', 'python3.12', 'ensurepip', '__init__.py'));
  writeFile(join(root, 'lib', 'python3.12', 'site-packages', 'pip', '__init__.py'));
  writeFile(join(root, 'lib', 'python3.12', 'site-packages', 'pip-26.2.1.dist-info', 'METADATA'));
  writeFile(join(root, 'lib', 'python3.12', 'site-packages', 'README.txt'));
  writeFile(join(root, 'lib', 'python3.12', 'lib-dynload', '_tkinter.cpython-312.so'));
  writeFile(join(root, 'lib', 'python3.12', 'lib-dynload', '_json.cpython-312.so'));
  const archive = join(work, 'python.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', work, 'python']);
  return { archive, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex') };
}

function pinFor(sha256: string) {
  return { version: '3.12.15', release: '20261001', sha256: { 'linux-x64': sha256 } };
}

describe('pinned bundled Python', () => {
  it('pins a hash for every platform it has a build for', () => {
    const pin = resolvePythonPin(repoRoot);
    expect(Object.keys(pin.sha256).sort()).toEqual(Object.keys(PYTHON_TRIPLES).sort());
    for (const hash of Object.values(pin.sha256)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(pythonAssetName(pin, 'win32-x64')).toBe(
      `cpython-${pin.version}+${pin.release}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`
    );
  });
});

describe('preparePython', () => {
  it('verifies, extracts and prunes the archive, then writes VERSION last', () => {
    const { archive, sha256 } = makeArchive();
    const projectRoot = tmp();
    const urls: string[] = [];
    const download = (url: string, dest: string) => {
      urls.push(url);
      writeFileSync(dest, readFileSync(archive));
    };

    const exe = preparePython({
      projectRoot,
      platform: 'linux',
      arch: 'x64',
      pin: pinFor(sha256),
      download,
      baseUrl: 'https://mirror.test',
    });

    const dest = join(projectRoot, 'resources', 'bundled-python', 'linux-x64');
    expect(exe).toBe(join(dest, 'bin', 'python3'));
    expect(urls).toEqual([
      'https://mirror.test/20261001/cpython-3.12.15%2B20261001-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz',
    ]);
    expect(readFileSync(join(dest, 'VERSION'), 'utf-8').trim()).toBe('3.12.15+20261001');
    for (const kept of [
      'bin/python3',
      'lib/libpython3.12.so',
      'lib/python3.12/json/__init__.py',
      'lib/python3.12/site-packages/README.txt',
      'lib/python3.12/lib-dynload/_json.cpython-312.so',
    ]) {
      expect(existsSync(join(dest, kept)), kept).toBe(true);
    }
    for (const pruned of [
      'bin/pip3',
      'bin/python3.12-config',
      'include',
      'share',
      'lib/libtcl9.0.so',
      'lib/tk9.0',
      'lib/python3.12/tkinter',
      'lib/python3.12/ensurepip',
      'lib/python3.12/site-packages/pip',
      'lib/python3.12/site-packages/pip-26.2.1.dist-info',
      'lib/python3.12/lib-dynload/_tkinter.cpython-312.so',
    ]) {
      expect(existsSync(join(dest, pruned)), pruned).toBe(false);
    }
  });

  it('rejects an archive whose hash does not match the pin and leaves nothing behind', () => {
    const { archive } = makeArchive();
    const projectRoot = tmp();
    const download = (_url: string, dest: string) => writeFileSync(dest, readFileSync(archive));

    expect(() =>
      preparePython({ projectRoot, platform: 'linux', arch: 'x64', pin: pinFor('0'.repeat(64)), download })
    ).toThrow(/does not match the pinned/);
    expect(existsSync(join(projectRoot, 'resources', 'bundled-python', 'linux-x64'))).toBe(false);
  });

  it('keeps a bundle whose VERSION matches the pin without downloading again', () => {
    const { archive, sha256 } = makeArchive();
    const projectRoot = tmp();
    const download = vi.fn((_url: string, dest: string) => writeFileSync(dest, readFileSync(archive)));
    const args = { projectRoot, platform: 'linux', arch: 'x64', pin: pinFor(sha256), download };

    preparePython(args);
    preparePython(args);

    expect(download).toHaveBeenCalledTimes(1);
  });

  it('refuses a platform without a pinned hash', () => {
    expect(() =>
      preparePython({
        projectRoot: tmp(),
        platform: 'darwin',
        arch: 'arm64',
        pin: pinFor('0'.repeat(64)),
        download: vi.fn(),
      })
    ).toThrow(/no pin for darwin-arm64/);
  });
});
