import { describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { provisionGateway } from '@process/services/managedagents/install';
import type { BackendCall } from '@process/services/managedagents/backend';
import { configFixture } from './managedFixture';
import { expandLeadingTilde } from '@/common/gateway/provisionGateway';

describe('managed Claude configuration', () => {
  it('expands Windows profiles without mixed separators and preserves POSIX names', () => {
    expect(expandLeadingTilde('~/profile/config', 'C:\\Users\\employee\\')).toBe(
      'C:\\Users\\employee\\profile\\config'
    );
    expect(expandLeadingTilde('~\\profile', '\\\\server\\home\\employee')).toBe('\\\\server\\home\\employee\\profile');
    expect(expandLeadingTilde('~/literal\\name', '/home/employee')).toBe('/home/employee/literal\\name');
  });
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
  it('writes the department Claude Code model to ANTHROPIC_MODEL', async () => {
    const writes: { route: string; body: { env_override: { name: string; value: string }[] } }[] = [];
    const backend: BackendCall = async <T>(method: string, route: string, body?: unknown): Promise<T> => {
      if (method !== 'GET') writes.push({ route, body: body as (typeof writes)[number]['body'] });
      if (route === '/api/agents/management') return [{ id: '2d23ff1c', enabled: true }] as T;
      if (route === '/api/providers') return (method === 'GET' ? [] : { id: 'gateway' }) as T;
      return { command_override: '/managed/claude', env_override: [] } as T;
    };
    const cfg = configFixture();
    cfg.gateway!.claude_model = 'test-model';
    await provisionGateway(cfg, {
      backend,
      skillsRoot: '/unused',
      serverUrl: 'http://config',
      deptKey: 'test',
      clientId: 'test',
      prepareClaude: vi.fn(),
    });
    const env = writes.find((w) => w.route === '/api/agents/2d23ff1c/overrides')!.body.env_override;
    expect(env).toContainEqual({ name: 'ANTHROPIC_MODEL', value: 'test-model' });
    expect(env).toContainEqual({ name: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', value: 'test-model' });
  });

  it("writes the department's Claude Code context window and removes it once the department drops it (spec 018)", async () => {
    let stored: { name: string; value: string }[] = [{ name: 'HTTP_PROXY', value: 'http://squid:3128' }];
    const backend: BackendCall = async <T>(method: string, route: string, body?: unknown): Promise<T> => {
      if (route === '/api/agents/management') return [{ id: '2d23ff1c', enabled: true }] as T;
      if (route === '/api/providers') return (method === 'GET' ? [] : { id: 'gateway' }) as T;
      if (method === 'PUT') stored = (body as { env_override: typeof stored }).env_override;
      return { command_override: '/managed/claude', env_override: stored } as T;
    };
    const install = (claude_context_tokens: number | null | undefined) => {
      const cfg = configFixture();
      cfg.gateway!.claude_context_tokens = claude_context_tokens;
      return provisionGateway(cfg, {
        backend,
        skillsRoot: '/unused',
        serverUrl: 'http://config',
        deptKey: 'test',
        clientId: 'test',
        prepareClaude: vi.fn(),
      });
    };
    const contextWindow = () => stored.filter((e) => e.name === 'CLAUDE_CODE_MAX_CONTEXT_TOKENS').map((e) => e.value);

    await install(262144);
    expect(contextWindow()).toEqual(['262144']);
    expect(stored.some((e) => e.name === 'CLAUDE_CODE_AUTO_COMPACT_WINDOW')).toBe(false);
    await install(undefined);
    expect(contextWindow()).toEqual([]);
    expect(stored).toContainEqual({ name: 'HTTP_PROXY', value: 'http://squid:3128' });
  });

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
