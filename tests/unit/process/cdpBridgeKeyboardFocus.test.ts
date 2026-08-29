/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * [ENTERPRISE PATCH] spec 007 FR-8 — keyboard-input commands pull app focus back
 * into the webview before forwarding; nothing else may touch focus.
 *
 * Chromium routes CDP keyboard/text injection to the app-wide FOCUSED widget, not
 * to the session's own target, so with focus in the host chat input an agent
 * `fill` typed its form values into the chat box (conversation 7a4f0946). The
 * bridge therefore focuses the attached webview before Input.dispatchKeyEvent /
 * Input.insertText / Input.imeSetComposition — and, as a pinned negative
 * constraint, never for mouse/evaluate/screenshot commands, and never lets a
 * focus failure swallow the forwarded command.
 */

import { afterAll, describe, expect, it, vi } from 'vitest';

type FakeContents = {
  id: number;
  isDestroyed: () => boolean;
  getType: () => string;
  getTitle: () => string;
  getURL: () => string;
  focused: boolean;
  focusImpl: () => void;
  isFocused: () => boolean;
  focus: () => void;
  hostWebContents?: {
    isDestroyed: () => boolean;
    executeJavaScript: (script: string, gesture?: boolean) => Promise<unknown>;
  };
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
/** Interleaved call log so ordering (focus before forward) is assertable. */
const calls: string[] = [];

const makeContents = (id: number): FakeContents => {
  const contents: FakeContents = {
    id,
    isDestroyed: () => false,
    getType: () => 'webview',
    getTitle: () => 'Example',
    getURL: () => 'https://example.com',
    focused: false,
    focusImpl: () => {},
    isFocused: () => contents.focused,
    focus: () => {
      calls.push('focus');
      contents.focusImpl();
      contents.focused = true;
    },
    hostWebContents: {
      isDestroyed: () => false,
      executeJavaScript: async () => {
        calls.push('embedder-focus');
        contents.focusImpl();
        contents.focused = true;
        return { found: true, wasActive: false };
      },
    },
    debugger: {
      isAttached: () => false,
      attach: () => {},
      detach: () => {},
      on: () => {},
      removeListener: () => {},
      sendCommand: async (method: string) => {
        calls.push(`send:${method}`);
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

describe('cdpBridge — keyboard input forces webview focus (spec 007 FR-8)', () => {
  let bridge: Awaited<ReturnType<typeof startCdpBridge>> | undefined;
  let ws: WebSocket | undefined;
  afterAll(async () => {
    ws?.close();
    await bridge?.close();
  });

  it('focuses the unfocused webview before forwarding each keyboard method', async () => {
    const contents = makeContents(60);
    bridge = await startCdpBridge();
    expect(bridge.attach(60)).toEqual({ ok: true });
    ws = await connect(bridge.port, bridge.token);

    for (const method of ['Input.dispatchKeyEvent', 'Input.insertText', 'Input.imeSetComposition']) {
      contents.focused = false;
      calls.length = 0;
      const reply = await request(ws, 1, method, { text: 'x' });
      expect(reply.result).toEqual({});
      expect(calls).toEqual(['embedder-focus', `send:${method}`]);
    }
  });

  it('re-runs the embedder focus script on every keyboard command (self-healing, guard signals measured false)', async () => {
    contentsById.get(60)!.focused = true;
    calls.length = 0;
    await request(ws!, 2, 'Input.insertText', { text: 'x' });
    await request(ws!, 2, 'Input.insertText', { text: 'y' });
    expect(calls).toEqual(['embedder-focus', 'send:Input.insertText', 'embedder-focus', 'send:Input.insertText']);
  });

  it('never touches focus for mouse, evaluate, or screenshot commands, even unfocused', async () => {
    const contents = contentsById.get(60)!;
    for (const method of ['Input.dispatchMouseEvent', 'Runtime.evaluate', 'Page.captureScreenshot']) {
      contents.focused = false;
      calls.length = 0;
      await request(ws!, 3, method, {});
      expect(calls).toEqual([`send:${method}`]);
    }
  });

  it('still forwards the command when the embedder focus script rejects', async () => {
    const contents = contentsById.get(60)!;
    contents.focused = false;
    contents.hostWebContents!.executeJavaScript = async () => {
      calls.push('embedder-focus');
      throw new Error('script failed');
    };
    calls.length = 0;
    const reply = await request(ws!, 4, 'Input.dispatchKeyEvent', { type: 'char', text: 'a' });
    expect(reply.result).toEqual({});
    expect(calls).toEqual(['embedder-focus', 'send:Input.dispatchKeyEvent']);
  });

  it('falls back to contents.focus() when there is no embedder, and still forwards', async () => {
    const contents = contentsById.get(60)!;
    contents.focused = false;
    contents.hostWebContents = undefined;
    calls.length = 0;
    const reply = await request(ws!, 5, 'Input.insertText', { text: 'x' });
    expect(reply.result).toEqual({});
    expect(calls).toEqual(['focus', 'send:Input.insertText']);
  });

  it('forwards even when the script finds no matching webview', async () => {
    const contents = contentsById.get(60)!;
    contents.focused = false;
    contents.hostWebContents = {
      isDestroyed: () => false,
      executeJavaScript: async () => {
        calls.push('embedder-focus');
        return { found: false, wasActive: false };
      },
    };
    calls.length = 0;
    const reply = await request(ws!, 6, 'Input.insertText', { text: 'x' });
    expect(reply.result).toEqual({});
    expect(calls).toEqual(['embedder-focus', 'send:Input.insertText']);
  });
});
