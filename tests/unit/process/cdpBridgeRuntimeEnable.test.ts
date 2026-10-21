/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Every bridge client's Runtime.enable must announce the page's existing execution contexts.
 *
 * All clients share the webContents' single debugger session. Chrome only announces existing
 * contexts when Runtime goes from disabled to enabled, so after one client enabled it, the next
 * client's Runtime.enable received no contexts and puppeteer's first evaluate timed out after
 * 5000 ms on an idle page (measured live 2026-10-21: 0 contexts vs 4 after disable + enable).
 * The bridge therefore disables Runtime before forwarding each Runtime.enable. Pinned negative
 * constraint: no other command (including Page.enable and Runtime.evaluate) gains a disable.
 */

import { afterAll, describe, expect, it, vi } from 'vitest';

type FakeContents = {
  id: number;
  isDestroyed: () => boolean;
  getType: () => string;
  getTitle: () => string;
  getURL: () => string;
  isFocused: () => boolean;
  focus: () => void;
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
const calls: string[] = [];
let failDisable = false;

const makeContents = (id: number): FakeContents => {
  const contents: FakeContents = {
    id,
    isDestroyed: () => false,
    getType: () => 'webview',
    getTitle: () => 'K3',
    getURL: () => 'http://k3.example/k3cloud/html5/dform.aspx',
    isFocused: () => true,
    focus: () => {},
    debugger: {
      isAttached: () => false,
      attach: () => {},
      detach: () => {},
      on: () => {},
      removeListener: () => {},
      sendCommand: async (method: string) => {
        calls.push(`send:${method}`);
        if (method === 'Runtime.disable' && failDisable) throw new Error('Runtime is not enabled');
        return {};
      },
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

import { startCdpBridge } from '@process/resources/builtinMcp/cdpBridge';

const connect = (port: number, token: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/aionui-cdp?token=${token}`);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error('ws connect failed')));
  });

const request = (ws: WebSocket, id: number, method: string, params?: unknown) =>
  new Promise<Record<string, unknown>>((resolve) => {
    ws.addEventListener('message', function onMessage(event) {
      const msg = JSON.parse(String((event as MessageEvent).data)) as { id?: number };
      if (msg.id === id) {
        ws.removeEventListener('message', onMessage);
        resolve(msg as Record<string, unknown>);
      }
    });
    ws.send(JSON.stringify({ id, method, params }));
  });

describe('cdpBridge — Runtime.enable re-announces existing contexts', () => {
  let bridge: Awaited<ReturnType<typeof startCdpBridge>> | undefined;
  let ws: WebSocket | undefined;
  afterAll(async () => {
    ws?.close();
    await bridge?.close();
  });

  it('disables Runtime on the shared session before forwarding a client Runtime.enable', async () => {
    makeContents(70);
    bridge = await startCdpBridge();
    expect(bridge.attach(70)).toEqual({ ok: true });
    ws = await connect(bridge.port, bridge.token);
    calls.length = 0;
    const reply = await request(ws, 1, 'Runtime.enable');
    expect(reply.result).toEqual({});
    expect(calls).toEqual(['send:Runtime.disable', 'send:Runtime.enable']);
  });

  it('does the same for every later Runtime.enable (each client needs the announcement)', async () => {
    calls.length = 0;
    await request(ws!, 2, 'Runtime.enable');
    expect(calls).toEqual(['send:Runtime.disable', 'send:Runtime.enable']);
  });

  it('never adds a disable to other commands', async () => {
    for (const method of ['Page.enable', 'Runtime.evaluate', 'Runtime.callFunctionOn', 'Network.enable']) {
      calls.length = 0;
      await request(ws!, 3, method, {});
      expect(calls).toEqual([`send:${method}`]);
    }
  });

  it('still forwards Runtime.enable when the disable is rejected', async () => {
    failDisable = true;
    calls.length = 0;
    const reply = await request(ws!, 4, 'Runtime.enable');
    expect(reply.result).toEqual({});
    expect(calls).toEqual(['send:Runtime.disable', 'send:Runtime.enable']);
    failDisable = false;
  });
});
