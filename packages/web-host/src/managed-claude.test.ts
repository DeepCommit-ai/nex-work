import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { deriveClaudeBinaryPath, provisionManagedClaude, resolveBundledClaudeCandidates } from './managed-claude.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'managed-claude-test-'));

/** 造出与真实分发一致的布局：bundled-aioncore/<plat-arch>/ 与 bundled-claude/<plat-arch>/ 同级。 */
function makeLayout(root: string, { withPayload = true } = {}) {
  const binDir = path.join(root, 'bundled-aioncore', 'linux-x64');
  fs.mkdirSync(binDir, { recursive: true });
  const aioncore = path.join(binDir, 'aioncore');
  fs.writeFileSync(aioncore, '');
  if (withPayload) {
    const dir = path.join(root, 'bundled-claude', 'linux-x64');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\n', { mode: 0o755 });
  }
  return aioncore;
}

afterEach(() => {
  delete process.env.AIONUI_MANAGED_CLAUDE;
  delete process.env.AIONUI_CLAUDE_BIN;
  vi.restoreAllMocks();
});

describe('layout derivation', () => {
  it('derives bundled-claude as a sibling of bundled-aioncore — the one layout all three distributions share', () => {
    expect(deriveClaudeBinaryPath('/app/resources/bundled-aioncore/linux-x64/aioncore', 'linux', 'x64')).toBe(
      '/app/resources/bundled-claude/linux-x64/claude'
    );
    expect(deriveClaudeBinaryPath('/app/resources/bundled-aioncore/win32-x64/aioncore.exe', 'win32', 'x64')).toBe(
      path.resolve('/app/resources/bundled-claude/win32-x64/claude.exe')
    );
  });
});

describe('provisionManagedClaude', () => {
  it('pins command_override to the bundled binary, carrying env_override through untouched', async () => {
    const root = tmp();
    const aioncore = makeLayout(root);
    const env = [{ name: 'ANTHROPIC_BASE_URL', value: 'http://gw:54000' }];
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (!init) return { ok: true, json: async () => ({ data: { command_override: null, env_override: env } }) };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;

    await provisionManagedClaude({
      aioncoreBinaryPath: aioncore,
      backendPort: 1234,
      fetchImpl,
      platform: 'linux',
      arch: 'x64',
    });

    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(put).toBeTruthy();
    const body = JSON.parse(String(put!.init!.body));
    expect(body.command_override).toBe(path.join(root, 'bundled-claude', 'linux-x64', 'claude'));
    // PUT 是整体替换（实测）：env 丢了 = 网关四件套被清空，流量绕过网关。
    expect(body.env_override).toEqual(env);
  });

  it('does not PUT when already pinned to the bundled binary', async () => {
    const root = tmp();
    const aioncore = makeLayout(root);
    const pinned = path.join(root, 'bundled-claude', 'linux-x64', 'claude');
    const puts: RequestInit[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      if (init) puts.push(init);
      return { ok: true, json: async () => ({ data: { command_override: pinned, env_override: [] } }) };
    }) as unknown as typeof fetch;

    await provisionManagedClaude({
      aioncoreBinaryPath: aioncore,
      backendPort: 1234,
      fetchImpl,
      platform: 'linux',
      arch: 'x64',
    });
    expect(puts.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('skips loudly when the payload is absent — dev checkouts fall back to PATH claude', async () => {
    const root = tmp();
    const aioncore = makeLayout(root, { withPayload: false });
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await provisionManagedClaude({
      aioncoreBinaryPath: aioncore,
      backendPort: 1,
      fetchImpl,
      platform: 'linux',
      arch: 'x64',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('honors the AIONUI_MANAGED_CLAUDE=0 escape hatch', async () => {
    process.env.AIONUI_MANAGED_CLAUDE = '0';
    const root = tmp();
    const aioncore = makeLayout(root);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await provisionManagedClaude({
      aioncoreBinaryPath: aioncore,
      backendPort: 1,
      fetchImpl,
      platform: 'linux',
      arch: 'x64',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('honors AIONUI_CLAUDE_BIN as a direct override', async () => {
    const root = tmp();
    const aioncore = makeLayout(root, { withPayload: false });
    const custom = path.join(root, 'my-claude');
    fs.writeFileSync(custom, '', { mode: 0o755 });
    process.env.AIONUI_CLAUDE_BIN = custom;
    const calls: { init?: RequestInit }[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push({ init });
      if (!init) return { ok: true, json: async () => ({ data: { command_override: null, env_override: [] } }) };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
    await provisionManagedClaude({
      aioncoreBinaryPath: aioncore,
      backendPort: 1,
      fetchImpl,
      platform: 'linux',
      arch: 'x64',
    });
    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(JSON.parse(String(put!.init!.body)).command_override).toBe(custom);
  });
});

describe('expandConfigDirTilde', () => {
  it('展开字面 ~ 的 CLAUDE_CONFIG_DIR,其他条目原样', async () => {
    const { expandConfigDirTilde } = await import('./managed-claude.js');
    const { env, changed } = expandConfigDirTilde(
      [
        { name: 'CLAUDE_CONFIG_DIR', value: '~/.nexwork-claude' },
        { name: 'ANTHROPIC_BASE_URL', value: 'http://127.0.0.1:54000' },
      ],
      '/home/emp'
    );
    expect(changed).toBe(true);
    expect(env[0].value).toBe('/home/emp/.nexwork-claude');
    expect(env[1].value).toBe('http://127.0.0.1:54000');
  });

  it('绝对路径不动、changed=false', async () => {
    const { expandConfigDirTilde } = await import('./managed-claude.js');
    const { env, changed } = expandConfigDirTilde(
      [{ name: 'CLAUDE_CONFIG_DIR', value: '/home/emp/.nexwork-claude' }],
      '/home/emp'
    );
    expect(changed).toBe(false);
    expect(env[0].value).toBe('/home/emp/.nexwork-claude');
  });
});

describe('resolveBundledClaudeCandidates', () => {
  it('lists the distribution layout first, then the repo-root dev fallback', () => {
    const candidates = resolveBundledClaudeCandidates(
      '/app/resources/bundled-aioncore/linux-x64/aioncore',
      'linux',
      'x64',
      '/repo'
    );
    expect(candidates).toEqual([
      '/app/resources/bundled-claude/linux-x64/claude',
      path.resolve('/repo', 'resources', 'bundled-claude', 'linux-x64', 'claude'),
    ]);
  });
});

describe('dev fallback — aioncore resolved from PATH', () => {
  /**
   * 实测 2026-08-29：dev 模式 aioncore 来自 ~/.local/bin，`<bin>/../..` 推导到
   * $HOME，载荷却在仓库 resources/ 下 ——「每次启动重钉」在 dev 里从不发生，
   * 版本漂移提示一直存在。cwd 回退让 dev 与分发布局走同一条钉入路径。
   */
  it('pins to <cwd>/resources/bundled-claude when the sibling layout has no payload', async () => {
    const home = tmp();
    const aioncore = path.join(home, '.local', 'bin', 'aioncore');
    fs.mkdirSync(path.dirname(aioncore), { recursive: true });
    fs.writeFileSync(aioncore, '');

    const repo = tmp();
    const payloadDir = path.join(repo, 'resources', 'bundled-claude', 'linux-x64');
    fs.mkdirSync(payloadDir, { recursive: true });
    const payload = path.join(payloadDir, 'claude');
    fs.writeFileSync(payload, '#!/bin/sh\n', { mode: 0o755 });

    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (!init) return { ok: true, json: async () => ({ data: { command_override: null, env_override: [] } }) };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;

    await provisionManagedClaude({
      aioncoreBinaryPath: aioncore,
      backendPort: 1234,
      fetchImpl,
      platform: 'linux',
      arch: 'x64',
      cwd: repo,
    });

    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(put).toBeDefined();
    expect(JSON.parse(String(put!.init!.body)).command_override).toBe(payload);
  });

  it('still skips loudly when neither candidate exists', async () => {
    const home = tmp();
    const aioncore = path.join(home, '.local', 'bin', 'aioncore');
    fs.mkdirSync(path.dirname(aioncore), { recursive: true });
    fs.writeFileSync(aioncore, '');

    const calls: { url: string }[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push({ url });
      return { ok: true, json: async () => ({ data: {} }) };
    }) as unknown as typeof fetch;

    await provisionManagedClaude({
      aioncoreBinaryPath: aioncore,
      backendPort: 1234,
      fetchImpl,
      platform: 'linux',
      arch: 'x64',
      cwd: tmp(),
    });

    expect(calls).toHaveLength(0);
  });
});
