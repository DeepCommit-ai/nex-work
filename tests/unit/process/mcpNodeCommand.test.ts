/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * [ENTERPRISE PATCH] spec 007 FR-3 — the builtin browser MCP transport is fed
 * verbatim into Claude Code's `--mcp-config`, and claude resolves a bare
 * `node` from its inherited PATH. On a machine whose PATH-first node is broken
 * (measured: brew node 25.6.1, dyld-killed on launch) the MCP server dies
 * before the handshake. The resolver must fall back to aioncore's managed
 * runtime with an absolute path — and must NOT trust the upstream
 * `isCommandAvailable` semantics, which treat any non-ENOENT failure as
 * "available" (a dyld crash is exactly such a failure).
 */

import path from 'node:path';
import * as childProcess from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  listManagedNodeCandidates,
  probeBundledNodeWorks,
  probeNodeWorks,
  readBundledNode,
  resolveMcpNodeCommand,
} from '@/process/utils/mcpNodeCommand';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const fsWith = (entries: Record<string, string[] | true>) => ({
  existsSync: (p: string) => Object.prototype.hasOwnProperty.call(entries, p),
  readdirSync: (p: string) => {
    const value = entries[p];
    if (Array.isArray(value)) return value as never;
    throw new Error(`not a directory: ${p}`);
  },
});

const ROOT = '/data/runtime/node';

describe('listManagedNodeCandidates', () => {
  it('lists bin/node per version dir, highest version first', () => {
    const fsImpl = fsWith({
      [ROOT]: ['node-v22.9.0-darwin-arm64', 'node-v24.11.0-darwin-arm64', 'stray-file'],
      [path.join(ROOT, 'node-v24.11.0-darwin-arm64', 'bin', 'node')]: true,
      [path.join(ROOT, 'node-v22.9.0-darwin-arm64', 'bin', 'node')]: true,
    });
    expect(listManagedNodeCandidates(ROOT, 'darwin', fsImpl)).toEqual([
      path.join(ROOT, 'node-v24.11.0-darwin-arm64', 'bin', 'node'),
      path.join(ROOT, 'node-v22.9.0-darwin-arm64', 'bin', 'node'),
    ]);
  });

  it('tolerates a flat layout (node.exe beside the version dir) on Windows', () => {
    const fsImpl = fsWith({
      [ROOT]: ['node-v24.11.0-win32-x64'],
      [path.join(ROOT, 'node-v24.11.0-win32-x64', 'node.exe')]: true,
    });
    expect(listManagedNodeCandidates(ROOT, 'win32', fsImpl)).toEqual([
      path.join(ROOT, 'node-v24.11.0-win32-x64', 'node.exe'),
    ]);
  });

  it('returns empty when the runtime root does not exist', () => {
    expect(listManagedNodeCandidates(ROOT, 'darwin', fsWith({}))).toEqual([]);
  });
});

describe('resolveMcpNodeCommand', () => {
  const managedNode = path.join(ROOT, 'node-v24.11.0-darwin-arm64', 'bin', 'node');
  const managedFs = fsWith({
    [ROOT]: ['node-v24.11.0-darwin-arm64'],
    [managedNode]: true,
  });

  it('keeps the bare `node` when the complete PATH toolchain runs cleanly', async () => {
    const probe = vi.fn().mockResolvedValue(true);
    await expect(
      resolveMcpNodeCommand({ runtimeNodeRoot: ROOT, probe, platform: 'darwin', fsImpl: managedFs })
    ).resolves.toEqual({ command: 'node', source: 'path' });
    expect(probe).toHaveBeenCalledExactlyOnceWith('node');
  });

  it('falls back to the managed runtime with an absolute path when PATH node is broken', async () => {
    const probe = vi.fn(async (command: string) => command !== 'node');
    await expect(
      resolveMcpNodeCommand({ runtimeNodeRoot: ROOT, probe, platform: 'darwin', fsImpl: managedFs })
    ).resolves.toEqual({ command: managedNode, source: 'managed' });
  });

  it('skips managed candidates that also fail the probe', async () => {
    const probe = vi.fn().mockResolvedValue(false);
    await expect(
      resolveMcpNodeCommand({ runtimeNodeRoot: ROOT, probe, platform: 'darwin', fsImpl: managedFs })
    ).resolves.toEqual({ command: 'node', source: 'fallback' });
  });

  it('falls back loudly-but-unchanged when nothing exists at all', async () => {
    const probe = vi.fn().mockResolvedValue(false);
    await expect(
      resolveMcpNodeCommand({ runtimeNodeRoot: ROOT, probe, platform: 'darwin', fsImpl: fsWith({}) })
    ).resolves.toEqual({ command: 'node', source: 'fallback' });
  });

  it('runs a packaged app on the node it ships, without consulting PATH (spec 019)', async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const bundledProbe = vi.fn().mockResolvedValue(true);
    await expect(
      resolveMcpNodeCommand({
        runtimeNodeRoot: ROOT,
        probe,
        bundledProbe,
        bundledNode: '/App/node',
        platform: 'darwin',
        fsImpl: managedFs,
      })
    ).resolves.toEqual({ command: '/App/node', source: 'bundled' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('keeps the PATH and managed ladder when the shipped node cannot run', async () => {
    const probe = vi.fn(async (command: string) => command !== 'node');
    await expect(
      resolveMcpNodeCommand({
        runtimeNodeRoot: ROOT,
        probe,
        bundledProbe: vi.fn().mockResolvedValue(false),
        bundledNode: '/App/node',
        platform: 'darwin',
        fsImpl: managedFs,
      })
    ).resolves.toEqual({ command: managedNode, source: 'managed' });
  });
});

describe('readBundledNode', () => {
  const managed = path.join('/App/Resources', 'bundled-aioncore', 'win32-x64', 'managed-resources');
  const manifest = JSON.stringify({ node: { root: 'node/node-v24.11.0-win-x64', executable: 'node.exe' } });
  const executable = path.join(managed, 'node/node-v24.11.0-win-x64', 'node.exe');
  const fsOf = (files: Record<string, string>) => ({
    existsSync: (p: string) => p in files,
    readFileSync: ((p: string) => {
      if (!(p in files)) throw new Error(`missing ${p}`);
      return files[p];
    }) as never,
  });

  it('follows the managed-resources manifest to the shipped executable', () => {
    const files = { [path.join(managed, 'manifest.json')]: manifest, [executable]: '' };
    expect(readBundledNode('/App/Resources', 'win32', 'x64', fsOf(files))).toBe(executable);
  });

  it('returns nothing when the manifest or its executable is absent', () => {
    expect(readBundledNode('/App/Resources', 'win32', 'x64', fsOf({}))).toBeUndefined();
    expect(
      readBundledNode('/App/Resources', 'win32', 'x64', fsOf({ [path.join(managed, 'manifest.json')]: manifest }))
    ).toBeUndefined();
  });
});

/** Run a probe script in a sandbox whose process.exit really stops it, as in a child node. */
const mockProbeRun = (platform: string, nodeVersion: string, spawnSync: () => unknown) =>
  vi.mocked(childProcess.execFile).mockImplementation((...args: unknown[]) => {
    const script = (args[1] as string[])[1];
    const callback = args[3] as (error: Error | null) => void;
    const exited = new Error('exited');
    try {
      runInNewContext(script, {
        require: (name: string) => (name === 'node:child_process' ? { spawnSync } : path),
        process: {
          execPath: path.join('/runtime', 'node'),
          platform,
          versions: { node: nodeVersion },
          env: { Path: '/existing' },
          exit: (code: number) => {
            callback(code ? new Error('probe failed') : null);
            throw exited;
          },
        },
      });
    } catch (error) {
      if (error !== exited) throw error;
    }
    return {} as childProcess.ChildProcess;
  });

describe('probeNodeWorks', () => {
  it.each([
    { platform: 'win32', status: 1, error: undefined, usable: false },
    { platform: 'linux', status: null, error: new Error('ENOENT'), usable: false },
    { platform: 'win32', status: 0, error: undefined, usable: true },
    { platform: 'darwin', status: 0, error: undefined, usable: true },
  ])('requires a working npx on $platform (usable=$usable)', async ({ platform, status, error, usable }) => {
    const spawnSync = vi.fn(() => ({ status, error }));
    const exec = mockProbeRun(platform, '24.11.0', spawnSync);
    try {
      await expect(probeNodeWorks('node')).resolves.toBe(usable);
      expect(spawnSync).toHaveBeenCalledWith(
        platform === 'win32' ? 'cmd.exe' : 'npx',
        platform === 'win32' ? ['/d', '/c', 'npx', '--version'] : ['--version'],
        expect.objectContaining({
          env: { Path: path.join('/runtime') + path.delimiter + '/existing' },
          windowsHide: true,
        })
      );
    } finally {
      exec.mockReset();
    }
  });

  it.each(['18.20.4', '20.18.0', '22.11.0'])(
    'rejects node %s that chrome-devtools-mcp cannot run, even with a working npx (spec 019)',
    async (nodeVersion) => {
      const spawnSync = vi.fn(() => ({ status: 0 }));
      const exec = mockProbeRun('darwin', nodeVersion, spawnSync);
      try {
        await expect(probeNodeWorks('node')).resolves.toBe(false);
        expect(spawnSync).not.toHaveBeenCalled();
      } finally {
        exec.mockReset();
      }
    }
  );
});

describe('probeBundledNodeWorks', () => {
  it.each([
    { nodeVersion: '24.11.0', usable: true },
    { nodeVersion: '20.19.0', usable: true },
    { nodeVersion: '18.20.4', usable: false },
  ])('checks only the node version, never npx ($nodeVersion)', async ({ nodeVersion, usable }) => {
    const spawnSync = vi.fn(() => ({ status: 1 }));
    const exec = mockProbeRun('win32', nodeVersion, spawnSync);
    try {
      await expect(probeBundledNodeWorks('/App/node')).resolves.toBe(usable);
      expect(spawnSync).not.toHaveBeenCalled();
    } finally {
      exec.mockReset();
    }
  });
});
