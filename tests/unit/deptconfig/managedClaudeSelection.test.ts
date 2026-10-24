/**
 * Spec 014: one Claude Code assistant on a model and context window of its own.
 *
 * cynapse serves the assistant's Claude Code catalog name (`claude_selection`: `opus`) and the
 * slot's model (`gateway.claude_slots`, e.g. `glm-5.3[1m]` — the marker gives Claude Code a 1M window). The managed install pins the selection as the
 * assistant's default model — aioncore keeps it because it is in Claude Code's own catalog, while
 * the gateway alias (`fixed_model`) would be dropped — and maps only the opus slot to that model,
 * so every other Claude Code assistant stays on the department default.
 */

import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installCatalog } from '@process/services/managedagents/install';
import type { BackendCall } from '@process/services/managedagents/backend';
import { catalogFixture, configFixture } from './managedFixture';

type Body = Record<string, unknown> & { id?: string; enabled_skills?: string[]; agent_id?: string };

const fakeBackend = () => {
  const assistants = new Map<string, Body>();
  const rules = new Map<string, string>();
  let overrides: { command_override: string | null; env_override: { name: string; value: string }[] } = {
    command_override: '/managed/claude',
    env_override: [],
  };
  const backend: BackendCall = async <T>(method: string, route: string, body?: unknown): Promise<T> => {
    const b = body as Body;
    if (route === '/api/assistants' && method === 'GET')
      return [...assistants.keys()].map((id) => ({ id, enabled: true })) as T;
    if (route === '/api/assistants' && method === 'POST') {
      assistants.set(b.id!, b);
      return b as T;
    }
    const one = route.match(/^\/api\/assistants\/([^/?]+)/);
    if (one && method === 'PUT') {
      assistants.set(one[1], b);
      return b as T;
    }
    if (one && method === 'GET') {
      const a = assistants.get(one[1])!;
      return {
        profile: { avatar: a.avatar ?? '' },
        prompts: { recommended: a.recommended_prompts ?? [] },
        engine: { agent_id: a.agent_id },
        capabilities: { default_skill_ids: a.enabled_skills ?? [] },
        rules: { content: rules.get(one[1]) ?? '' },
        state: { enabled: true },
        defaults: a.defaults,
      } as T;
    }
    if (route === '/api/skills/assistant-rule/write') {
      const r = body as { assistant_id: string; content: string };
      rules.set(r.assistant_id, r.content);
      return {} as T;
    }
    if (route === '/api/agents/management') return [{ id: '2d23ff1c', enabled: true }] as T;
    if (route === '/api/providers') return (method === 'GET' ? [] : { id: 'gateway' }) as T;
    if (route === '/api/agents/2d23ff1c/overrides') {
      if (method === 'PUT') overrides = body as typeof overrides;
      return overrides as T;
    }
    if (route === '/api/mcp/servers' && method === 'GET') return [] as T;
    if (route === '/api/mcp/servers' && method === 'POST')
      return { id: 'mgmt', name: 'nexwork-management', enabled: true } as T;
    return {} as T;
  };
  return { backend, assistants, overrides: () => overrides };
};

describe('managed install — a Claude Code assistant on its own model (spec 014)', () => {
  it('pins opus for that assistant and maps only the opus slot to its model and window', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'nexwork-014-'));
    try {
      const cfg = configFixture();
      cfg.model_aliases = ['test-model', 'big-model'];
      cfg.gateway!.claude_model = 'test-model';
      cfg.gateway!.claude_slots = { opus: 'big-model[1m]' };
      cfg.assistants = cfg.assistants.map((a) =>
        a.id === 'office-assistant'
          ? { ...a, fixed_model: 'big-model', context_window: '1m', claude_selection: 'opus' }
          : a.id === 'default-assistant'
            ? { ...a, fixed_model: 'test-model' }
            : a
      );
      const { backend, assistants, overrides } = fakeBackend();

      await installCatalog(cfg, catalogFixture(), {
        backend,
        skillsRoot: path.join(root, 'skills'),
        serverUrl: 'http://config',
        deptKey: 'test',
        clientId: 'test',
        prepareClaude: vi.fn(),
        locales: ['zh-CN'],
      });

      const model = (id: string) => (assistants.get(id)!.defaults as { model: unknown }).model;
      expect(model('office-assistant')).toEqual({ mode: 'fixed', value: 'opus' });
      expect(model('default-assistant')).toEqual({ mode: 'fixed', value: 'test-model' });
      const env = Object.fromEntries(overrides().env_override.map((e) => [e.name, e.value]));
      expect(env.ANTHROPIC_MODEL).toBe('test-model');
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('test-model');
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('test-model');
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('big-model[1m]');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
