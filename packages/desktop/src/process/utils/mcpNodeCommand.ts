/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * [ENTERPRISE PATCH] spec 007 FR-3 — 给内置 stdio MCP 挑一个真正能跑的 node。
 *
 * 内置浏览器 MCP 的 transport 写的是裸 `command: "node"`。aioncore 自己 spawn 它
 * 时会用受管 node 运行时，没问题；但同一条 transport 也被原样拼进 Claude Code 的
 * `--mcp-config`，而 **claude 只按继承的 PATH 解析 `node`** —— 在 PATH 首位 node
 * 坏掉的机器上（实测：brew node 25.6.1 缺 libllhttp dylib，dyld 直接杀进程），
 * MCP 服务器死在握手前，claude 会话里浏览器工具静默消失。
 *
 * 解析阶梯（每次启动重算，跟内置 MCP 脚本路径的逐启动对齐是同一个模式）：
 *
 *   1. PATH 里的 `node` 能跑（`--version` 干净退出）→ 保持裸 `node`，与上游零漂移。
 *   2. 否则在 aioncore 的受管运行时目录（`<dataDir>/runtime/node/node-v<ver>-<plat>-<arch>`）
 *      里找能跑的 node，版本从高到低，写**绝对路径**。这正是 aioncore 自己 spawn
 *      MCP 时用的运行时，机器上有 aioncore 就有它。
 *   3. 都没有 → 回落裸 `node` 并响亮记日志——保持今天的行为，绝不因此挡启动。
 *
 * 注意与上游 `isCommandAvailable` 的差别：那个把「非 ENOENT 错误」当可用（为的是
 * 容忍 npx 对 --version 的怪脾气），而 dyld 崩溃恰恰是非 ENOENT 错误——按那个语义
 * 坏 node 会被判成好的。这里的探测必须严格：只有干净退出才算能用。
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type NodeProbe = (command: string) => Promise<boolean>;

type FsLike = Pick<typeof fs, 'existsSync' | 'readdirSync'>;

/** Strict probe: usable only when `--version` exits cleanly. */
export const probeNodeWorks: NodeProbe = (command) =>
  new Promise((resolve) => {
    try {
      execFile(command, ['--version'], { timeout: 3000 }, (error) => resolve(!error));
    } catch {
      resolve(false);
    }
  });

const versionKey = (dirName: string): number[] => {
  const match = dirName.match(/^node-v(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
};

const byVersionDesc = (a: string, b: string): number => {
  const [aKey, bKey] = [versionKey(a), versionKey(b)];
  for (let i = 0; i < 3; i += 1) {
    if (aKey[i] !== bKey[i]) return bKey[i] - aKey[i];
  }
  return 0;
};

/**
 * List managed-runtime node binaries under `<runtimeNodeRoot>/node-v<ver>-…`,
 * highest version first. Layout differences are tolerated by candidate probing
 * (`bin/node` first, then a bare `node` beside the version dir).
 */
export const listManagedNodeCandidates = (
  runtimeNodeRoot: string,
  platform: NodeJS.Platform = process.platform,
  fsImpl: FsLike = fs
): string[] => {
  const exe = platform === 'win32' ? 'node.exe' : 'node';
  try {
    if (!fsImpl.existsSync(runtimeNodeRoot)) return [];
    return fsImpl
      .readdirSync(runtimeNodeRoot)
      .filter((name) => /^node-v\d+\./.test(name))
      .toSorted(byVersionDesc)
      .flatMap((name) => [path.join(runtimeNodeRoot, name, 'bin', exe), path.join(runtimeNodeRoot, name, exe)])
      .filter((candidate) => fsImpl.existsSync(candidate));
  } catch {
    return [];
  }
};

export type McpNodeResolution = {
  command: string;
  source: 'path' | 'managed' | 'fallback';
};

export const resolveMcpNodeCommand = async (opts: {
  runtimeNodeRoot: string;
  probe?: NodeProbe;
  platform?: NodeJS.Platform;
  fsImpl?: FsLike;
}): Promise<McpNodeResolution> => {
  const probe = opts.probe ?? probeNodeWorks;
  if (await probe('node')) return { command: 'node', source: 'path' };
  for (const candidate of listManagedNodeCandidates(opts.runtimeNodeRoot, opts.platform, opts.fsImpl)) {
    if (await probe(candidate)) return { command: candidate, source: 'managed' };
  }
  return { command: 'node', source: 'fallback' };
};
