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
import { describe, expect, it, vi } from 'vitest';
import { listManagedNodeCandidates, resolveMcpNodeCommand } from '@/process/utils/mcpNodeCommand';

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

  it('keeps the bare `node` when PATH node runs cleanly (zero upstream drift)', async () => {
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
});
