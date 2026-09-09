import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareNexworkAssistants, reconcileNexworkAssistants } from '@/branding/assistants/runtime';
import { NEXWORK_ASSISTANT_IDS } from '@/branding/assistants/policy';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('assistant resources before backend startup', () => {
  it('repairs damaged resources and uses the same directory on repeated starts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nexwork-assistants-'));
    directories.push(dir);
    const first = prepareNexworkAssistants(dir);
    const rule = path.join(first.AIONUI_BUILTIN_ASSISTANTS_PATH, 'rules/nexwork-assistant.en-US.md');
    writeFileSync(rule, 'stale AionUi rules');
    expect(prepareNexworkAssistants(dir)).toEqual(first);
    expect(readFileSync(rule, 'utf8')).toContain('You are the NexWork assistant.');
  });

  it('fails when resources cannot be written instead of using upstream defaults', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nexwork-assistants-'));
    directories.push(dir);
    writeFileSync(path.join(dir, 'nexwork-resources'), 'not a directory');
    expect(() => prepareNexworkAssistants(dir)).toThrow();
  });
});

describe('assistant state reconciliation', () => {
  function backend(options: { missing?: boolean; reject?: boolean; ignoreWrites?: boolean } = {}) {
    const states = [...NEXWORK_ASSISTANT_IDS, 'aionui-assistant', 'oa-form-assistant', 'bare:2d23ff1c'].map((id) => ({
      id,
      enabled: !NEXWORK_ASSISTANT_IDS.includes(id as (typeof NEXWORK_ASSISTANT_IDS)[number]),
    }));
    if (options.missing) states.splice(0, 1);
    const api = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'PATCH') {
        if (options.reject) return new Response('unavailable', { status: 503 });
        const id = decodeURIComponent(String(input).split('/').at(-2)!);
        if (!options.ignoreWrites)
          states.find((state) => state.id === id)!.enabled = JSON.parse(String(init.body)).enabled;
      }
      return Response.json({ success: true, data: states });
    });
    return { api, states };
  }

  it('disables all other records without deleting them and is idempotent', async () => {
    const { api, states } = backend();
    await reconcileNexworkAssistants(1234, api);
    expect(states.filter((state) => state.enabled).map((state) => state.id)).toEqual([...NEXWORK_ASSISTANT_IDS]);
    api.mockClear();
    await reconcileNexworkAssistants(1234, api);
    expect(api.mock.calls.every(([, init]) => !init?.method)).toBe(true);
    expect(states).toHaveLength(7);
  });

  it('does not disable existing assistants when the replacement catalog is missing', async () => {
    const { api } = backend({ missing: true });
    await expect(reconcileNexworkAssistants(1234, api)).rejects.toThrow('Missing NexWork assistant');
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('reports failed writes', async () => {
    await expect(reconcileNexworkAssistants(1234, backend({ reject: true }).api)).rejects.toThrow('503');
  });

  it('rejects a backend that accepts writes without applying them', async () => {
    await expect(reconcileNexworkAssistants(1234, backend({ ignoreWrites: true }).api)).rejects.toThrow(
      'did not converge'
    );
  });
});
