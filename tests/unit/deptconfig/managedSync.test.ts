import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ManagedAgentService } from '@process/services/managedagents/ManagedAgentService';
import { CatalogRestorationError } from '@process/services/managedagents/install';
import type { BackendCall } from '@process/services/managedagents/backend';
import { configFixture } from './managedFixture';
import * as skillMounts from '@process/services/managedagents/workspaceSkills';

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((run) => run());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('native skill preflight engine boundaries', () => {
  it('does not inspect or change Claude mounts for an Aion native conversation', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'managed-engine-boundary-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(path.join(root, '.claude'), 'An unrelated, user-owned file');
    const backend: BackendCall = async <T>() =>
      ({ type: 'acp', extra: { backend: 'aion', workspace: root, skills: ['review-nw-0123456789ab'] } }) as T;
    const service = new ManagedAgentService({
      backend,
      dataDir: root,
      skillsRoot: path.join(root, 'skills', 'aaaaaaaaaaaaaaaa'),
    });
    expect(await service.prepareRuntime('aion-conversation')).toBe(0);
  });

  it('rejects an invalid identifier without making a backend request', async () => {
    const backend = vi.fn<BackendCall>();
    const service = new ManagedAgentService({ backend, dataDir: os.tmpdir(), skillsRoot: os.tmpdir() });
    await expect(service.prepareRuntime('../other-conversation')).rejects.toThrow('Invalid conversation identifier');
    expect(backend).not.toHaveBeenCalled();
  });
});

describe('warm Claude skill recovery', () => {
  const setupRuntime = (state = 'idle', team = false) => {
    let broken = true;
    let runtime = {
      has_task: true,
      state,
      is_processing: state === 'running',
      pending_confirmations: state === 'waiting_confirmation' ? 1 : 0,
    };
    const mounts = vi
      .spyOn(skillMounts, 'prepareWorkspaceSkills')
      .mockImplementation((_workspace, _names, _root, _platform, inspectOnly) => {
        if (inspectOnly) return broken ? 1 : 0;
        const repaired = broken ? 1 : 0;
        broken = false;
        return repaired;
      });
    const restart = vi.fn(async (_route: string) => undefined);
    const backend: BackendCall = async <T>(method: string, route: string) => {
      if (method === 'POST') return (await restart(route)) as T;
      return {
        type: 'acp',
        extra: {
          backend: 'claude',
          workspace: os.tmpdir(),
          skills: ['review-nw-0123456789ab'],
          ...(team ? { teamId: 'team', slot_id: 'slot' } : {}),
        },
        runtime,
      } as T;
    };
    return {
      service: new ManagedAgentService({ backend, dataDir: os.tmpdir(), skillsRoot: os.tmpdir() }),
      mounts,
      restart,
      setIdle: () => {
        runtime = { has_task: true, state: 'idle', is_processing: false, pending_confirmations: 0 };
      },
      isBroken: () => broken,
    };
  };

  it('rebuilds an idle cached Claude once when concurrent messages request recovery', async () => {
    const f = setupRuntime();
    expect(await Promise.all([f.service.prepareRuntime('warm'), f.service.prepareRuntime('warm')])).toEqual([1, 1]);
    expect(f.restart).toHaveBeenCalledTimes(1);
    expect(f.isBroken()).toBe(false);
  });

  it('does not replace mounts or interrupt a turn waiting for approval', async () => {
    const f = setupRuntime('waiting_confirmation');
    await expect(f.service.prepareRuntime('warm')).rejects.toThrow('approval to finish');
    expect([f.isBroken(), f.restart.mock.calls.length]).toEqual([true, 0]);
    f.setIdle();
    expect(await f.service.prepareRuntime('warm')).toBe(1);
  });

  it('retries a failed runtime rebuild even though the copied skill is now readable', async () => {
    const f = setupRuntime();
    f.restart.mockRejectedValueOnce(new Error('Restart failed'));
    await expect(f.service.prepareRuntime('warm')).rejects.toThrow('Restart failed');
    expect(await f.service.prepareRuntime('warm')).toBe(0);
    expect(f.restart).toHaveBeenCalledTimes(2);
  });
  it('refreshes a team-owned runtime through its team slot without resetting the conversation', async () => {
    const f = setupRuntime('idle', true);
    await f.service.prepareRuntime('team-conversation');
    expect(f.restart).toHaveBeenCalledWith('/api/teams/team/agents/slot/runtime/restart');
  });
});

function setup(stored = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'managed-sync-'));
  let cfg = configFixture();
  let invalid = false;
  let stallEvents = false;
  let offline = false;
  let rejectedUrl = '';
  const settings: Record<string, unknown> = stored
    ? { 'enterprise.serverUrl': 'http://config.test', 'enterprise.deptKey': 'stored-key' }
    : {};
  const installed: number[] = [];
  let eventController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const requests: string[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    if (offline) throw new Error('Network unavailable');
    if (invalid || (rejectedUrl && url.startsWith(rejectedUrl))) return new Response('{}', { status: 401 });
    if (url.endsWith('/registry/events')) {
      if (stallEvents)
        return new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('Connection timed out')), { once: true })
        );
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            eventController = controller;
            init?.signal?.addEventListener('abort', () => {
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            });
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    }
    if (url.endsWith('/config/version')) return Response.json({ version: cfg.version, etag: cfg.version });
    if (url.endsWith('/report')) return Response.json({ ok: true });
    return Response.json(cfg);
  }) as typeof fetch;
  const backend: BackendCall = async <T>(method: string, route: string, body?: unknown): Promise<T> => {
    if (method === 'PUT' && route === '/api/settings/client') Object.assign(settings, body);
    return (
      route === '/api/assistants'
        ? cfg.assistants.map((a) => ({ id: a.id, enabled: true }))
        : route === '/api/agents/management'
          ? cfg.agents.map((id) => ({ id, enabled: true }))
          : settings
    ) as T;
  };
  const install = vi.fn(async (config: typeof cfg) => {
    installed.push(config.agent_catalog!.revision);
    return config.assistants.map((a) => a.id);
  });
  const service = new ManagedAgentService({
    backend,
    dataDir: root,
    skillsRoot: path.join(root, 'skills'),
    fetch: fetcher,
    install,
    pollMs: 1000,
    random: () => 0.5,
  });
  cleanup.push(() => {
    service.stop();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    service,
    install,
    installed,
    fetcher,
    requests,
    settings,
    rejectUrl: (url: string) => {
      rejectedUrl = url;
    },
    setRevision: (revision: number) => {
      cfg = configFixture(revision);
    },
    revoke: (value = true) => {
      invalid = value;
    },
    offline: (value: boolean) => {
      offline = value;
    },
    stallEvents: (value: boolean) => {
      stallEvents = value;
    },
    disconnect: () => eventController?.close(),
    corrupt: () => {
      cfg.agent_catalog!.digest = '0'.repeat(64);
    },
    push: () => eventController?.enqueue(new TextEncoder().encode('event: catalog_changed\ndata: {}\n\n')),
  };
}

describe('desktop synchronization lifecycle', () => {
  it('blocks new conversations with a damaged offline cache until repair succeeds', async () => {
    const s = setup(true);
    mkdirSync(path.join(s.root, 'nexwork-managed'));
    writeFileSync(path.join(s.root, 'nexwork-managed/installed.json'), '{corrupt');
    s.offline(true);
    await s.service.bootstrap();
    expect((await s.service.waitReady()).success).toBe(false);
    s.offline(false);
    await s.service.sync(true);
    expect((await s.service.waitReady()).success).toBe(true);
  });

  it('declares catalog support so a shared department key is not served the release contract', async () => {
    const s = setup();
    await s.service.connect({ serverUrl: 'http://config.test', deptKey: 'test-key' });
    const declared = vi
      .mocked(s.fetcher)
      .mock.calls.filter(([url]) => /\/config(\/version)?$/.test(String(url)))
      .map(([, init]) => new Headers(init?.headers).get('X-NexWork-Capabilities'));
    expect(declared.length).toBeGreaterThanOrEqual(2);
    expect(new Set(declared)).toEqual(new Set(['agent-catalog']));
  });

  it('keeps the active authenticated identity when a replacement key is rejected', async () => {
    const s = setup();
    await s.service.connect({ serverUrl: 'http://config.test', deptKey: 'test-key' });
    await s.service.sync();
    s.rejectUrl('http://replacement.test');
    const result = await s.service.connect({ serverUrl: 'http://replacement.test', deptKey: 'wrong-key' });
    expect(result.errorCode).toBe('INVALID_KEY');
    expect(result.status.connection).toMatchObject({
      state: 'connected',
      serverUrl: 'http://config.test',
      dept: 'default',
    });
    expect(s.settings['enterprise.serverUrl']).toBe('http://config.test');
  });
  it('retains the last identity but stops claiming connectivity after network failure', async () => {
    const s = setup();
    await s.service.connect({ serverUrl: 'http://config.test', deptKey: 'test-key' });
    await s.service.sync();
    const verifiedAt = s.service.snapshot().connection?.verifiedAt;
    s.offline(true);
    const result = await s.service.sync();
    expect(result.status.connection).toEqual({
      state: 'unreachable',
      serverUrl: 'http://config.test',
      dept: 'default',
      verifiedAt,
    });
    expect(result.errorCode).toBe('SERVICE_UNREACHABLE');
    s.offline(false);
    expect((await s.service.sync()).status.connection?.state).toBe('connected');
  });
  it('distinguishes a reachable service from a local installation failure', async () => {
    const s = setup();
    await s.service.connect({ serverUrl: 'http://config.test', deptKey: 'test-key' });
    await s.service.sync();
    s.setRevision(2);
    s.install.mockRejectedValueOnce(new Error('Local installation failed'));
    const result = await s.service.sync();
    expect(result.status.connection?.state).toBe('connected');
    expect(result.errorCode).toBe('UPDATE_FAILED');
    expect(result.status.revision).toBe(1);
  });
  it('restores an offline identity only for the matching saved service address', async () => {
    const s = setup(true);
    s.settings['enterprise.connectionIdentity'] = { serverUrl: 'http://other.test', dept: 'sales', verifiedAt: 123 };
    s.offline(true);
    await s.service.bootstrap();
    expect(s.service.snapshot().connection).toEqual({ state: 'unreachable', serverUrl: 'http://config.test' });
  });
  it('marks a cached identity as unreachable after an offline startup', async () => {
    const s = setup(true);
    s.settings['enterprise.connectionIdentity'] = { serverUrl: 'http://config.test', dept: 'sales', verifiedAt: 123 };
    s.offline(true);
    await s.service.bootstrap();
    expect(s.service.snapshot().connection).toEqual({
      state: 'unreachable',
      serverUrl: 'http://config.test',
      dept: 'sales',
      verifiedAt: 123,
    });
  });
  it('rechecks the configuration endpoint when push drops without declaring a service outage', async () => {
    const s = setup();
    await s.service.connect({ serverUrl: 'http://config.test', deptKey: 'test-key' });
    await s.service.sync();
    const checks = s.requests.filter((url) => url.endsWith('/config/version')).length;
    s.disconnect();
    await vi.waitFor(() =>
      expect(s.requests.filter((url) => url.endsWith('/config/version')).length).toBeGreaterThan(checks)
    );
    await s.service.sync();
    expect(s.service.snapshot()).toMatchObject({ push: 'disconnected', connection: { state: 'connected' } });
  });
  it('shows a revoked credential and permits a manual retry after it is restored', async () => {
    const s = setup();
    await s.service.connect({ serverUrl: 'http://config.test', deptKey: 'test-key' });
    await s.service.sync();
    s.revoke();
    expect((await s.service.sync()).status.connection?.state).toBe('unauthorized');
    s.revoke(false);
    expect((await s.service.sync(true)).status.connection?.state).toBe('connected');
  });
  it('discovers a new publication through push and ignores duplicate events', async () => {
    const s = setup();
    await s.service.connect({ serverUrl: 'http://config.test', deptKey: 'local-test-key' });
    await vi.waitFor(() => expect(s.service.snapshot().push).toBe('connected'));
    s.setRevision(2);
    s.push();
    s.push();
    await vi.waitFor(() => expect(s.service.snapshot().revision).toBe(2));
    expect(s.installed).toEqual([1, 2]);
  });
  it('keeps polling when push does not deliver an event', async () => {
    vi.useFakeTimers();
    const s = setup();
    await s.service.connect({ serverUrl: 'http://config.test', deptKey: 'local-test-key' });
    await s.service.sync();
    s.setRevision(3);
    await vi.advanceTimersByTimeAsync(1100);
    expect(s.installed).toContain(3);
  });
  it('stops automatic traffic after authentication is revoked', async () => {
    vi.useFakeTimers();
    const s = setup();
    await s.service.connect({ serverUrl: 'http://config.test', deptKey: 'local-test-key' });
    await s.service.sync();
    s.revoke();
    await s.service.sync();
    const count = s.requests.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.service.snapshot().phase).toBe('unauthorized');
    expect(s.requests).toHaveLength(count);
  });
  it('reports installation failure without advancing the installed revision', async () => {
    const s = setup();
    await s.service.connect({ serverUrl: 'http://config.test', deptKey: 'local-test-key' });
    await s.service.sync();
    s.setRevision(2);
    s.install.mockRejectedValueOnce(new Error('Disk unavailable'));
    const result = await s.service.sync();
    expect(result.success).toBe(false);
    expect(result.status.revision).toBe(1);
    expect(result.error).toContain('Disk unavailable');
  });
  it('reconnects after a stream interruption and discovers the current publication', async () => {
    vi.useFakeTimers();
    const s = setup();
    await s.service.connect({ serverUrl: 'http://config.test', deptKey: 'test-key' });
    await s.service.sync();
    s.disconnect();
    s.setRevision(2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.requests.filter((url) => url.endsWith('/registry/events'))).toHaveLength(2);
    expect(s.service.snapshot().revision).toBe(2);
  });
  it('retries an event connection timeout instead of losing push permanently', async () => {
    vi.useFakeTimers();
    const s = setup();
    s.stallEvents(true);
    await s.service.connect({ serverUrl: 'http://config.test', deptKey: 'test-key' });
    await vi.advanceTimersByTimeAsync(30_000);
    s.stallEvents(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.service.snapshot().push).toBe('connected');
  });
  it('rejects corrupted downloads without applying or advancing them', async () => {
    const s = setup();
    await s.service.connect({ serverUrl: 'http://config.test', deptKey: 'test-key' });
    await s.service.sync();
    s.setRevision(2);
    s.corrupt();
    expect((await s.service.sync()).success).toBe(false);
    expect(s.installed).toEqual([1]);
    expect(s.service.snapshot().revision).toBe(1);
  });
  it('blocks new conversations after an incomplete rollback until a successful repair', async () => {
    const s = setup();
    await s.service.connect({ serverUrl: 'http://config.test', deptKey: 'test-key' });
    await s.service.sync();
    s.setRevision(2);
    s.install.mockRejectedValueOnce(new CatalogRestorationError('Rollback failed'));
    await s.service.sync();
    expect((await s.service.waitReady()).success).toBe(false);
    await s.service.sync(true);
    expect((await s.service.waitReady()).success).toBe(true);
  });
  it('recovers automatically when a previously configured desktop starts offline', async () => {
    vi.useFakeTimers();
    const s = setup(true);
    s.offline(true);
    await s.service.bootstrap();
    expect(s.service.snapshot().phase).toBe('error');
    s.offline(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.service.snapshot().phase).toBe('ready');
    expect(s.installed).toEqual([1]);
  });
  it('holds activation until a conversation finishes reading and creating its snapshot', async () => {
    const s = setup();
    await s.service.connect({ serverUrl: 'http://config.test', deptKey: 'test-key' });
    await s.service.sync();
    const reservation = await s.service.acquireConversation();
    expect(reservation.lease).toBeTruthy();
    s.setRevision(2);
    const updating = s.service.sync();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(s.installed).toEqual([1]);
    s.service.releaseConversation(reservation.lease!);
    await updating;
    expect(s.installed).toEqual([1, 2]);
  });
});
