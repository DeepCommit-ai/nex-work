/**
 * Spec 018: the department-config service (the path outside Electron) writes the department's
 * Claude Code context window to Claude Code only. Other CLI agents keep whatever they have.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeptConfig } from '@/common/deptconfig/types';
import type { EnvEntry } from '@/common/gateway/types';

const CLAUDE = '2d23ff1c';
const TOKENS = 'CLAUDE_CODE_MAX_CONTEXT_TOKENS';

const mocks = vi.hoisted(() => ({
  overrides: new Map<string, { command_override: string | null; env_override: { name: string; value: string }[] }>(),
  fetch: vi.fn(),
}));

vi.mock('@/common/adapter/ipcBridge', () => {
  const ok = { invoke: vi.fn(async () => ({})) };
  return {
    acpConversation: {
      getManagedAgents: {
        invoke: vi.fn(async () => [
          { id: '2d23ff1c', enabled: true, agent_type: 'claude' },
          { id: 'codex-1', enabled: true, agent_type: 'codex' },
        ]),
      },
      getAgentOverrides: { invoke: vi.fn(async ({ id }: { id: string }) => mocks.overrides.get(id)) },
      setAgentOverrides: {
        invoke: vi.fn(async (body: { id: string; command_override: string | null; env_override: EnvEntry[] }) => {
          mocks.overrides.set(body.id, { command_override: body.command_override, env_override: body.env_override });
        }),
      },
      setAgentEnabled: ok,
    },
    application: { systemInfo: { invoke: vi.fn(async () => ({ workDir: '/home/employee/.aionui' })) } },
    assistants: {
      list: { invoke: vi.fn(async () => [{ id: 'word', enabled: true, agent_id: '2d23ff1c', enabled_skills: null }]) },
      get: { invoke: vi.fn(async () => undefined) },
      update: ok,
      setState: ok,
      create: ok,
    },
    deptSkills: { call: ok },
    mode: { listProviders: ok, updateProvider: ok, createProvider: ok },
  };
});
vi.mock('@/renderer/services/enterpriseStore', () => ({
  enterpriseStore: {
    setServerUrl: vi.fn(),
    setDeptKey: vi.fn(),
    getClientId: vi.fn(async () => 'client'),
    setApplyState: vi.fn(),
  },
}));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => false }));
vi.mock('@/common/deptconfig/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/deptconfig/client')>()),
  fetchDeptConfig: mocks.fetch,
  postReport: vi.fn(async () => ({ ok: true, drift: [] })),
}));

import { applyDeptConfig } from '@/renderer/services/deptConfigService';

const config = (claude_context_tokens: number | null): DeptConfig => ({
  version: 'v1',
  dept: 'advance',
  agents: [CLAUDE, 'codex-1'],
  assistants: [{ id: 'word', agent_id: CLAUDE }],
  model_aliases: ['k3.1-pro'],
  gateway: {
    base_url: 'http://gw',
    api_key: 'sk-dept',
    config_dir: '/home/employee/.nexwork-runtime',
    claude_model: 'k3.1-pro',
    claude_context_tokens,
  },
});

const contextWindow = (agentId: string) =>
  (mocks.overrides.get(agentId)?.env_override ?? []).filter((e) => e.name === TOKENS).map((e) => e.value);

describe('department-config service: Claude Code context window (spec 018)', () => {
  beforeEach(() => {
    mocks.overrides.clear();
    mocks.overrides.set(CLAUDE, { command_override: '/managed/claude', env_override: [] });
    // a value someone set on another CLI agent by hand
    mocks.overrides.set('codex-1', { command_override: null, env_override: [{ name: TOKENS, value: '131072' }] });
  });

  it('writes the window to Claude Code only and removes it once the department drops it', async () => {
    mocks.fetch.mockResolvedValue({ status: 'ok', config: config(262144) });
    expect((await applyDeptConfig('http://config', 'key')).status).toBe('applied');
    expect(contextWindow(CLAUDE)).toEqual(['262144']);
    expect(contextWindow('codex-1')).toEqual(['131072']);
    expect(mocks.overrides.get(CLAUDE)?.command_override).toBe('/managed/claude');

    mocks.fetch.mockResolvedValue({ status: 'ok', config: config(null) });
    expect((await applyDeptConfig('http://config', 'key')).status).toBe('applied');
    expect(contextWindow(CLAUDE)).toEqual([]);
    expect(contextWindow('codex-1')).toEqual(['131072']);
  });

  it('applies nothing when the served window is not usable', async () => {
    mocks.fetch.mockResolvedValue({ status: 'ok', config: config(0) });
    const outcome = await applyDeptConfig('http://config', 'key');
    expect(outcome).toMatchObject({ status: 'failed', detail: expect.stringContaining('claude_context_tokens') });
    expect(mocks.overrides.get(CLAUDE)?.env_override).toEqual([]);
  });
});
