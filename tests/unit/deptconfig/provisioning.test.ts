import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeptConfig } from '@/common/deptconfig/types';
import type { EnvEntry } from '@/common/gateway/types';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getOverrides: vi.fn(),
  setOverrides: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock('@/common/adapter/ipcBridge', () => ({
  application: { getPath: { invoke: async () => '/employees/alex' }, prepareNexworkClaude: { invoke: mocks.prepare } },
  acpConversation: {
    getManagedAgents: { invoke: async () => [{ id: '2d23ff1c', enabled: true, agent_type: 'acp' }] },
    getAgentOverrides: { invoke: mocks.getOverrides },
    setAgentOverrides: { invoke: mocks.setOverrides },
  },
  assistants: {
    list: {
      invoke: async () =>
        ['nexwork-assistant', 'word-creator', 'ppt-creator', 'excel-creator'].map((id) => ({
          id,
          enabled: true,
          agent_id: '2d23ff1c',
        })),
    },
  },
  deptSkills: {},
  mode: {},
}));
vi.mock('@/renderer/services/enterpriseStore', () => ({
  enterpriseStore: {
    setServerUrl: vi.fn(),
    setDeptKey: vi.fn(),
    getClientId: async () => 'test-client',
    setApplyState: vi.fn(),
  },
}));
vi.mock('@/common/deptconfig/client', () => ({
  fetchDeptConfig: mocks.fetch,
  postReport: async () => ({ ok: true, drift: [] }),
  toReportBody: vi.fn(),
  buildProvenanceEnvValue: () => 'test-provenance',
}));
vi.mock('@/common/capabilities/policy', () => ({ normalizePolicy: vi.fn(), setPolicy: vi.fn() }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => true }));
import { applyDeptConfig } from '@/renderer/services/deptConfigService';

const config = (configDir?: string): DeptConfig => ({
  dept: 'test',
  version: 'v13',
  agents: ['2d23ff1c'],
  model_aliases: ['company-model'],
  assistants: ['nexwork-assistant', 'word-creator', 'ppt-creator', 'excel-creator'].map((id) => ({
    id,
    agent_id: '2d23ff1c',
  })),
  gateway: { base_url: 'http://local-gateway', api_key: 'test-key', config_dir: configDir },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue({ success: true });
});

describe('department Claude office profile', () => {
  it.each([
    { provided: undefined, existing: '/profiles/current', expected: '/profiles/current' },
    { provided: undefined, existing: undefined, expected: '/employees/alex/.nexwork-claude' },
    { provided: '~/.department-claude', existing: '/profiles/current', expected: '/employees/alex/.department-claude' },
    { provided: undefined, existing: '~/.existing-claude', expected: '/employees/alex/.existing-claude' },
  ])('prepares the effective directory: $expected', async ({ provided, existing, expected }) => {
    mocks.fetch.mockResolvedValue({ status: 'ok', config: config(provided) });
    mocks.getOverrides.mockResolvedValue({
      command_override: '/managed/claude',
      env_override: existing ? [{ name: 'CLAUDE_CONFIG_DIR', value: existing }] : [],
    });
    const result = await applyDeptConfig('http://config', 'test-dept-key');
    expect(mocks.prepare).toHaveBeenCalledWith({ configDir: expected });
    expect(mocks.setOverrides).toHaveBeenCalledWith({
      id: '2d23ff1c',
      command_override: '/managed/claude',
      env_override: expect.arrayContaining([{ name: 'CLAUDE_CONFIG_DIR', value: expected }]),
    });
    expect(result).toMatchObject({ status: 'applied', report: { failures: [] } });
  });

  it('does not switch gateway or clear the managed command when profile preparation fails', async () => {
    const env: EnvEntry[] = [{ name: 'CLAUDE_CONFIG_DIR', value: '/profiles/current' }];
    mocks.fetch.mockResolvedValue({ status: 'ok', config: config('/profiles/new') });
    mocks.getOverrides.mockResolvedValue({ command_override: '/managed/claude', env_override: env });
    mocks.prepare.mockResolvedValue({ success: false, error: 'profile is read-only' });
    const result = await applyDeptConfig('http://config', 'test-dept-key');
    expect(mocks.setOverrides).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'applied',
      report: { failures: [expect.stringContaining('profile is read-only')] },
    });
  });
});
