import { describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { provisionGateway } from '@process/services/managedagents/install';
import type { BackendCall } from '@process/services/managedagents/backend';
import { configFixture } from './managedFixture';

describe('managed Claude configuration', () => {
  it.each([
    { provided: undefined, existing: '/profiles/current', expected: '/profiles/current' },
    { provided: undefined, existing: undefined, expected: path.join(os.homedir(), '.nexwork-runtime') },
    {
      provided: '~/.department-claude',
      existing: '/profiles/current',
      expected: path.join(os.homedir(), '.department-claude'),
    },
  ])(
    'prepares the effective profile and preserves command overrides: $expected',
    async ({ provided, existing, expected }) => {
      const writes: unknown[] = [];
      const backend: BackendCall = async <T>(method: string, route: string, body?: unknown): Promise<T> => {
        if (method !== 'GET') writes.push({ route, body });
        if (route === '/api/agents/management') return [{ id: '2d23ff1c', enabled: true }] as T;
        if (route === '/api/providers') return (method === 'GET' ? [] : { id: 'gateway' }) as T;
        return {
          command_override: '/managed/claude',
          env_override: existing ? [{ name: 'CLAUDE_CONFIG_DIR', value: existing }] : [],
        } as T;
      };
      const cfg = configFixture();
      cfg.gateway!.config_dir = provided;
      const prepare = vi.fn();
      await provisionGateway(cfg, {
        backend,
        skillsRoot: '/unused',
        serverUrl: 'http://config',
        deptKey: 'test',
        clientId: 'test',
        prepareClaude: prepare,
      });
      expect(prepare).toHaveBeenCalledWith(expected);
      expect(writes).toContainEqual({
        route: '/api/agents/2d23ff1c/overrides',
        body: {
          command_override: '/managed/claude',
          env_override: expect.arrayContaining([{ name: 'CLAUDE_CONFIG_DIR', value: expected }]),
        },
      });
    }
  );
  it('does not replace gateway credentials when profile preparation fails', async () => {
    const writes: string[] = [];
    const backend: BackendCall = async <T>(method: string, route: string): Promise<T> => {
      if (method !== 'GET') writes.push(route);
      return (
        route === '/api/providers' || route === '/api/agents/management'
          ? []
          : { command_override: '/managed/claude', env_override: [] }
      ) as T;
    };
    await expect(
      provisionGateway(configFixture(), {
        backend,
        skillsRoot: '/unused',
        serverUrl: 'http://config',
        deptKey: 'test',
        clientId: 'test',
        prepareClaude: () => {
          throw new Error('Read-only profile');
        },
      })
    ).rejects.toThrow('Read-only');
    expect(writes).toEqual([]);
  });
});
