/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * [ENTERPRISE PATCH] spec 010 — one conversation drives the in-app browser at a time, and the
 * app stays awake (no App Nap, no background throttling of the page) only while it does.
 *
 * Each conversation runs its own chrome-devtools-mcp over its own socket while the bridge serves a
 * single page. The connection that last drove the page holds a lease; any other connection's page
 * commands are refused with a readable message and that socket is closed (1013) so its puppeteer
 * reconnects cleanly later. Target.* stays ungated so handshakes complete. Discovery replies carry
 * their guidance in the HTTP reason phrase because puppeteer reports only statusText.
 */

import { afterAll, describe, expect, it, vi } from 'vitest';

type FakeContents = {
  id: number;
  isDestroyed: () => boolean;
  getType: () => string;
  getTitle: () => string;
  getURL: () => string;
  throttling: boolean[];
  setBackgroundThrottling: (allowed: boolean) => void;
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
};

const contentsById = new Map<number, FakeContents>();

const makeContents = (id: number): FakeContents => {
  const contents: FakeContents = {
    id,
    isDestroyed: () => false,
    getType: () => 'webview',
    getTitle: () => 'Example',
    getURL: () => 'https://example.com',
    throttling: [],
    setBackgroundThrottling: (allowed: boolean) => {
      contents.throttling.push(allowed);
    },
    debugger: {
      isAttached: () => false,
      attach: () => {},
      detach: () => {},
      on: () => {},
      removeListener: () => {},
      sendCommand: async () => ({}),
    },
    once: () => {},
    removeListener: () => {},
  };
  contentsById.set(id, contents);
  return contents;
};

vi.mock('electron', () => ({
  webContents: { fromId: (id: number) => contentsById.get(id) },
}));

import { BROWSER_BUSY_MESSAGE, startCdpBridge } from '@process/resources/builtinMcp/cdpBridge';

type Client = { ws: WebSocket; closed: Promise<{ code: number }> };

const connect = (port: number, token: string) =>
  new Promise<Client>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/aionui-cdp?token=${token}`);
    const closed = new Promise<{ code: number }>((res) => {
      ws.addEventListener('close', (event) => res({ code: event.code }));
    });
    ws.addEventListener('open', () => resolve({ ws, closed }));
    ws.addEventListener('error', () => reject(new Error('ws connect failed')));
  });

let nextId = 1;
const request = (ws: WebSocket, method: string, params: unknown = {}) =>
  new Promise<{ result?: unknown; error?: { message: string } }>((resolve) => {
    const id = nextId++;
    ws.addEventListener('message', function onMessage(event) {
      const msg = JSON.parse(String((event as MessageEvent).data)) as { id?: number };
      if (msg.id === id) {
        ws.removeEventListener('message', onMessage);
        resolve(msg as { result?: unknown; error?: { message: string } });
      }
    });
    ws.send(JSON.stringify({ id, method, params }));
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('cdpBridge — one driving conversation, awake only while driving (spec 010)', () => {
  const keepAwake = { start: vi.fn(() => 7), stop: vi.fn() };
  let bridge: Awaited<ReturnType<typeof startCdpBridge>> | undefined;
  afterAll(async () => {
    await bridge?.close();
  });

  it('refuses a second conversation while the first drives, then frees the page when the holder leaves', async () => {
    const page = makeContents(70);
    bridge = await startCdpBridge(undefined, { keepAwake, leaseIdleMs: 300 });
    expect(bridge.attach(70)).toEqual({ ok: true });

    const a = await connect(bridge.port, bridge.token);
    expect((await request(a.ws, 'Runtime.evaluate')).result).toEqual({});
    expect(keepAwake.start).toHaveBeenCalledTimes(1);
    expect(page.throttling).toEqual([false]);

    const b = await connect(bridge.port, bridge.token);
    // Handshake commands are answered locally and stay ungated.
    expect((await request(b.ws, 'Target.getTargets')).result).toHaveProperty('targetInfos');
    const refused = await request(b.ws, 'Page.navigate', { url: 'https://example.com/b' });
    expect(refused.error?.message).toBe(BROWSER_BUSY_MESSAGE);
    expect((await b.closed).code).toBe(1013);

    // A new client cannot even discover the browser while the holder is active.
    const busy = await fetch(`http://127.0.0.1:${bridge.port}/json/version`);
    expect(busy.status).toBe(503);
    expect(busy.statusText).toContain('another connection');
    await busy.text();

    // The holder keeps driving undisturbed.
    expect((await request(a.ws, 'Runtime.evaluate')).result).toEqual({});

    a.ws.close();
    await a.closed;
    await sleep(30);
    expect(keepAwake.stop).toHaveBeenCalledWith(7);
    expect(page.throttling).toEqual([false, true]);

    const c = await connect(bridge.port, bridge.token);
    expect((await request(c.ws, 'Page.navigate', { url: 'https://example.com/c' })).result).toEqual({});
    c.ws.close();
    await c.closed;
    await sleep(30); // let the server see the close before the next test counts calls
  });

  it('releases an idle lease so a finished conversation does not hold the browser', async () => {
    const handle = bridge!;
    keepAwake.start.mockClear();
    keepAwake.stop.mockClear();
    const a = await connect(handle.port, handle.token);
    expect((await request(a.ws, 'Runtime.evaluate')).result).toEqual({});
    expect(keepAwake.start).toHaveBeenCalledTimes(1);

    await sleep(400); // past leaseIdleMs, holder still connected
    expect(keepAwake.stop).toHaveBeenCalledTimes(1);
    expect(contentsById.get(70)!.throttling.at(-1)).toBe(true);

    const b = await connect(handle.port, handle.token);
    expect((await request(b.ws, 'Runtime.evaluate')).result).toEqual({});
    // Now the first one is the outsider.
    expect((await request(a.ws, 'Runtime.evaluate')).error?.message).toBe(BROWSER_BUSY_MESSAGE);
    expect((await a.closed).code).toBe(1013);
    b.ws.close();
    await b.closed;
    await sleep(30);
  });

  it('keeps the app awake while discovery waits and says how to recover in the status text', async () => {
    const handle = bridge!;
    handle.detach();
    keepAwake.start.mockClear();
    keepAwake.stop.mockClear();
    const realSetTimeout = globalThis.setTimeout;
    const timer = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((callback, delay, ...args) =>
        realSetTimeout(callback, delay === 10_000 ? 20 : delay, ...args)
      );
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/json/version`);
      expect(keepAwake.start).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(503);
      expect(res.statusText).toContain('retry the same tool call');
      await res.text();
      expect(keepAwake.stop).toHaveBeenCalledTimes(1);
    } finally {
      timer.mockRestore();
    }
  });

  it('keeps a long browser operation awake and exclusive beyond the idle lease interval', async () => {
    const handle = bridge!;
    handle.attach(70);
    const page = contentsById.get(70)!;
    const original = page.debugger.sendCommand;
    let complete!: (result: Record<string, never>) => void;
    const pending = new Promise<Record<string, never>>((resolve) => {
      complete = resolve;
    });
    page.debugger.sendCommand = async (method) => (method === 'Runtime.evaluate' ? pending : {});
    const a = await connect(handle.port, handle.token);
    try {
      const operation = request(a.ws, 'Runtime.evaluate');
      await sleep(400);
      expect(page.throttling.at(-1)).toBe(false);
      const b = await connect(handle.port, handle.token);
      expect((await request(b.ws, 'Page.navigate')).error?.message).toBe(BROWSER_BUSY_MESSAGE);
      await b.closed;
      complete({});
      expect((await operation).result).toEqual({});
    } finally {
      complete({});
      page.debugger.sendCommand = original;
      a.ws.close();
      await a.closed;
      await sleep(30);
    }
  });

  it('stays awake through a successful wait and lets go once discovery is answered', async () => {
    const handle = bridge!;
    handle.detach();
    keepAwake.start.mockClear();
    keepAwake.stop.mockClear();
    const discovery = fetch(`http://127.0.0.1:${handle.port}/json/version`);
    await sleep(30);
    expect(keepAwake.start).toHaveBeenCalledTimes(1);
    expect(keepAwake.stop).not.toHaveBeenCalled();
    expect(handle.attach(70)).toEqual({ ok: true });
    const res = await discovery;
    expect(res.status).toBe(200);
    await res.json();
    expect(keepAwake.stop).toHaveBeenCalledTimes(1);
  });
});
