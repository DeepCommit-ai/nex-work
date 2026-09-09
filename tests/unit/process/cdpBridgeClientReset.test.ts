/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * [ENTERPRISE PATCH] spec 007 FR-6 — attachment changes must reset live clients.
 *
 * A puppeteer client (chrome-devtools-mcp) that materializes its page while the
 * bridge is UNATTACHED caches the rejected pagePromise forever: every retry
 * replays the cached rejection without sending a byte, so the panel opening is
 * permanently invisible to that client (measured live: a conversation's browser
 * tools failed on every retry while /json/list showed a healthy attached page).
 * Protocol re-announces cannot cure it — puppeteer swaps sessions on duplicate
 * attachedToTarget announcements and keeps the poisoned target either way. The
 * bridge therefore closes client sockets (1012) on every genuine attachment
 * transition, forcing a clean reconnect on the next tool call.
 *
 * The contract has a load-bearing negative: a re-attach of the SAME webContents
 * (fired on every navigation's dom-ready) must NOT disconnect anyone.
 */

import { afterAll, describe, expect, it, vi } from 'vitest';
import { WebSocket as NodeWebSocket } from 'ws';
import { get } from 'node:http';
import { SINGLE_SESSION_ID, SINGLE_TARGET_ID } from '@process/resources/builtinMcp/cdpTargetProtocol';

type FakeContents = {
  id: number;
  isDestroyed: () => boolean;
  getType: () => string;
  getTitle: () => string;
  getURL: () => string;
  debugger: {
    isAttached: () => boolean;
    attach: () => void;
    detach: () => void;
    on: () => void;
    removeListener: () => void;
    sendCommand: (method: string, params: unknown) => Promise<Record<string, never>>;
  };
  once: (event: string, cb: () => void) => void;
  removeListener: () => void;
  emitDestroyed: () => void;
};

const contentsById = new Map<number, FakeContents>();
const sentCommands: { id: number; method: string; params: unknown }[] = [];

const makeContents = (id: number): FakeContents => {
  const listeners = new Map<string, () => void>();
  const contents: FakeContents = {
    id,
    isDestroyed: () => false,
    getType: () => 'webview',
    getTitle: () => 'Example',
    getURL: () => 'https://example.com',
    debugger: {
      isAttached: () => false,
      attach: () => {},
      detach: () => {},
      on: () => {},
      removeListener: () => {},
      sendCommand: async (method: string, params: unknown) => {
        sentCommands.push({ id, method, params });
        return {};
      },
    },
    once: (event, cb) => listeners.set(event, cb),
    removeListener: () => {},
    emitDestroyed: () => listeners.get('destroyed')?.(),
  };
  contentsById.set(id, contents);
  return contents;
};

vi.mock('electron', () => ({
  webContents: { fromId: (id: number) => contentsById.get(id) },
}));

import { startCdpBridge } from '@process/resources/builtinMcp/cdpBridge';

type CloseInfo = { code: number; reason: string };

const connect = (port: number, token: string) =>
  new Promise<{ ws: WebSocket; closed: Promise<CloseInfo> }>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/aionui-cdp?token=${token}`);
    const closed = new Promise<CloseInfo>((res) => {
      ws.addEventListener('close', (event) => res({ code: event.code, reason: event.reason }));
    });
    ws.addEventListener('open', () => resolve({ ws, closed }));
    ws.addEventListener('error', () => reject(new Error('ws connect failed')));
  });

const notClosedWithin = async (closed: Promise<CloseInfo>, ms: number): Promise<boolean> => {
  const sentinel = Symbol('open');
  const winner = await Promise.race([closed, new Promise((res) => setTimeout(() => res(sentinel), ms))]);
  return winner === sentinel;
};

type HandshakeCommand = { method: string; params: Record<string, unknown>; sessionId?: string };

const observeHandshake = async (port: number, token: string, commands: HandshakeCommand[]) => {
  // Puppeteer's transport yields between frames, so inspect state at each ACK.
  const ws = new NodeWebSocket(`ws://127.0.0.1:${port}/aionui-cdp?token=${token}`, {
    allowSynchronousEvents: false,
  });
  const events: string[] = [];
  const snapshots: string[][] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as { method?: string };
      if (message.method) events.push(message.method);
    });
    for (const [index, command] of commands.entries()) {
      await new Promise<void>((resolve) => {
        const onMessage = (raw: Buffer) => {
          const message = JSON.parse(String(raw)) as { id?: number };
          if (message.id !== index + 1) return;
          ws.off('message', onMessage);
          snapshots.push([...events]);
          resolve();
        };
        ws.on('message', onMessage);
        ws.send(JSON.stringify({ id: index + 1, ...command }));
      });
    }
    return snapshots;
  } finally {
    ws.close();
  }
};

describe('cdpBridge — attachment transitions reset live clients (spec 007 FR-6)', () => {
  let bridge: Awaited<ReturnType<typeof startCdpBridge>> | undefined;
  const requestBrowser = vi.fn();
  afterAll(async () => {
    await bridge?.close();
  });

  it('closes on first attach and re-attach elsewhere, never on same-target re-report, closes on destroy', async () => {
    makeContents(42);
    makeContents(43);
    const handle = await startCdpBridge(requestBrowser);
    bridge = handle;

    // 1. Client connected while unattached → first attach must reset it.
    const first = await connect(handle.port, handle.token);
    expect(handle.attach(42)).toEqual({ ok: true });
    const firstClose = await first.closed;
    expect(firstClose.code).toBe(1012);
    expect(firstClose.reason).toContain('reconnect');

    // 2. Same-webContents re-report (every navigation's dom-ready) must NOT disconnect.
    const second = await connect(handle.port, handle.token);
    expect(handle.attach(42)).toEqual({ ok: true });
    expect(await notClosedWithin(second.closed, 150)).toBe(true);

    // 3. Attaching a different webContents (tab switch) resets again.
    expect(handle.attach(43)).toEqual({ ok: true });
    expect((await second.closed).code).toBe(1012);

    // 4. Destroying the attached webview resets so no client drives a stale page.
    const third = await connect(handle.port, handle.token);
    contentsById.get(43)!.emitDestroyed();
    expect((await third.closed).code).toBe(1012);
  });

  /**
   * [ENTERPRISE PATCH] spec 007 FR-7 — new_page (Target.createTarget) navigates
   * the single attached page instead of being refused; unattached it returns the
   * retry guidance instead of sending the agent to hunt for a panel.
   */
  it('serves createTarget by navigating the attached page, and guides a retry when unattached', async () => {
    const handle = bridge!;
    expect(handle.attach(42)).toEqual({ ok: true });
    const client = await connect(handle.port, handle.token);

    const reply = (predicate: (msg: { id?: number }) => boolean) =>
      new Promise<Record<string, unknown>>((resolve) => {
        client.ws.addEventListener('message', function onMessage(event) {
          const msg = JSON.parse(String((event as MessageEvent).data)) as Record<string, unknown>;
          if (predicate(msg as { id?: number })) {
            client.ws.removeEventListener('message', onMessage);
            resolve(msg);
          }
        });
      });

    const navigated = reply((m) => m.id === 9);
    client.ws.send(JSON.stringify({ id: 9, method: 'Target.createTarget', params: { url: 'https://example.com/x' } }));
    const ok = await navigated;
    expect(ok.result).toEqual({ targetId: 'aionui-browser-target' });
    expect(sentCommands.at(-1)).toEqual({ id: 42, method: 'Page.navigate', params: { url: 'https://example.com/x' } });

    handle.detach();
    const refused = reply((m) => m.id === 10);
    client.ws.send(JSON.stringify({ id: 10, method: 'Target.createTarget', params: { url: 'https://example.com' } }));
    const err = (await refused).error as { message: string };
    expect(err.message).toContain('retry the same tool call');
    client.ws.close();
  });

  it('makes the page available before completing browser discovery and attachment', async () => {
    const handle = bridge!;
    expect(handle.attach(42)).toEqual({ ok: true });
    const snapshots = await observeHandshake(handle.port, handle.token, [
      { method: 'Target.setDiscoverTargets', params: { discover: true } },
      { method: 'Target.setAutoAttach', params: { autoAttach: true, flatten: true } },
    ]);
    expect(snapshots[0]).toEqual(['Target.targetCreated']);
    expect(snapshots[1]).toEqual(['Target.targetCreated', 'Target.attachedToTarget']);
  });

  it('announces a session once per connection without recursively attaching page sessions', async () => {
    const handle = bridge!;
    const commands = [
      { method: 'Target.setAutoAttach', params: { autoAttach: true }, sessionId: SINGLE_SESSION_ID },
      { method: 'Target.setAutoAttach', params: { autoAttach: true } },
      { method: 'Target.attachToTarget', params: { targetId: SINGLE_TARGET_ID } },
    ];
    const expected = [[], ['Target.attachedToTarget'], ['Target.attachedToTarget']];
    expect(await observeHandshake(handle.port, handle.token, commands)).toEqual(expected);
    expect(await observeHandshake(handle.port, handle.token, commands)).toEqual(expected);
  });

  it('waits for the auto-opened webview before allowing Puppeteer to connect', async () => {
    const handle = bridge!;
    handle.detach();
    let received = false;
    const discovery = fetch(`http://127.0.0.1:${handle.port}/json/version`).then((res) => {
      received = true;
      return res.json();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toBe(false);
    handle.attach(42);
    expect(await discovery).toHaveProperty('webSocketDebuggerUrl');
  });

  it('requests one browser for concurrent cold connections, never for diagnostics or an attached page', async () => {
    const handle = bridge!;
    requestBrowser.mockClear();
    await fetch(`http://127.0.0.1:${handle.port}/json/version`);
    handle.detach();
    await fetch(`http://127.0.0.1:${handle.port}/json/list`);
    expect(requestBrowser).not.toHaveBeenCalled();
    const first = fetch(`http://127.0.0.1:${handle.port}/json/version`);
    const second = fetch(`http://127.0.0.1:${handle.port}/json/version`);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(requestBrowser).toHaveBeenCalledTimes(1);
    handle.attach(42);
    await Promise.all([first, second]);
  });

  it('times out discovery if no webview arrives and allows a later connection', async () => {
    const handle = bridge!;
    handle.detach();
    const realSetTimeout = globalThis.setTimeout;
    const timer = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((callback, delay, ...args) =>
        realSetTimeout(callback, delay === 10_000 ? 10 : delay, ...args)
      );
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/json/version`);
      expect(res.status).toBe(503);
      expect(await res.text()).toContain('retry the same tool call');
      handle.attach(42);
      expect((await fetch(`http://127.0.0.1:${handle.port}/json/version`)).status).toBe(200);
    } finally {
      timer.mockRestore();
    }
  });

  it('drops canceled discovery requests without disrupting the next attachment', async () => {
    const handle = bridge!;
    handle.detach();
    const request = get(`http://127.0.0.1:${handle.port}/json/version`);
    request.on('error', () => {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    request.destroy();
    await new Promise((resolve) => request.once('close', resolve));
    expect(handle.attach(42)).toEqual({ ok: true });
    expect((await fetch(`http://127.0.0.1:${handle.port}/json/version`)).status).toBe(200);
  });

  it('settles pending discovery when the bridge shuts down', async () => {
    const handle = bridge!;
    handle.detach();
    const discovery = fetch(`http://127.0.0.1:${handle.port}/json/version`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const closing = handle.close();
    const response = await discovery;
    expect(response.status).toBe(503);
    await response.text();
    await closing;
    bridge = undefined;
  });
});
