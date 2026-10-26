import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareNexworkAssistants, reconcileNexworkAssistants } from '@/branding/assistants/runtime';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('assistant bootstrap', () => {
  it('repairs damaged historical assets without changing their original content', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nexwork-assistants-'));
    directories.push(dir);
    const first = prepareNexworkAssistants(dir);
    const rule = path.join(first.AIONUI_BUILTIN_ASSISTANTS_PATH, 'rules/word-creator.en-US.md');
    const original = readFileSync(rule, 'utf8');
    writeFileSync(rule, 'damaged');
    expect(prepareNexworkAssistants(dir)).toEqual(first);
    expect(readFileSync(rule, 'utf8')).toBe(original);
  });

  function backend(ignoreWrites = false) {
    const states = [
      { id: 'default-assistant', enabled: false },
      { id: 'office-assistant', enabled: false },
      { id: 'nexwork-butler', enabled: true },
      { id: 'legacy', enabled: true },
    ];
    const api = vi.fn<typeof fetch>(async (input, init) => {
      const route = new URL(String(input)).pathname;
      if (route === '/api/settings/client')
        return Response.json({
          success: true,
          data: { 'enterprise.managedIds': ['default-assistant', 'office-assistant', 'nexwork-butler'] },
        });
      if (init?.method === 'PATCH' && route.startsWith('/api/assistants/') && !ignoreWrites) {
        const state = states.find((s) => s.id === route.split('/')[3]);
        if (state) state.enabled = JSON.parse(String(init.body)).enabled;
      }
      return Response.json({ success: true, data: states });
    });
    return { api, states };
  }
  it('restores the required default, preserves optional preferences and retires legacy entries', async () => {
    const { api, states } = backend();
    await reconcileNexworkAssistants(1234, api);
    expect(states.filter((s) => s.enabled).map((s) => s.id)).toEqual(['default-assistant', 'nexwork-butler']);
    expect(api.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    const before = structuredClone(states);
    await reconcileNexworkAssistants(1234, api);
    expect(states).toEqual(before);
  });
  it('recreates a missing default that starts conversations on full-auto permission', async () => {
    const states: { id: string; enabled: boolean }[] = [];
    const created: Record<string, unknown>[] = [];
    const api = vi.fn<typeof fetch>(async (input, init) => {
      const route = new URL(String(input)).pathname;
      if (route === '/api/settings/client') return Response.json({ success: true, data: {} });
      if (init?.method === 'POST' && route === '/api/assistants') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown> & { id: string };
        created.push(body);
        states.push({ id: body.id, enabled: false });
      }
      if (init?.method === 'PATCH' && route === '/api/assistants/default-assistant/state') states[0].enabled = true;
      return Response.json({ success: true, data: states });
    });
    await reconcileNexworkAssistants(1234, api);
    expect(created.map((body) => body.id)).toEqual(['default-assistant']);
    expect(created[0].defaults).toMatchObject({ permission: { mode: 'fixed', value: 'bypassPermissions' } });
  });
  it('rejects acknowledged writes that leave the default disabled', async () => {
    await expect(reconcileNexworkAssistants(1234, backend(true).api)).rejects.toThrow('not enabled');
  });
});
