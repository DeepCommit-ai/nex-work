import { afterEach, describe, expect, it, vi } from 'vitest';
const pages = vi.hoisted(() => new Map<number, ReturnType<typeof page>>());
function page(id: number) {
  return {
    id,
    isDestroyed: () => false,
    getType: () => 'webview',
    getTitle: () => `page-${id}`,
    getURL: () => 'about:blank',
    reload: vi.fn(),
    reloadIgnoringCache: vi.fn(),
    setBackgroundThrottling: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    debugger: {
      isAttached: () => false,
      attach: vi.fn(),
      detach: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      sendCommand: vi.fn(async () => ({ page: id })),
    },
  };
}
vi.mock('electron', () => ({ webContents: { fromId: (id: number) => pages.get(id) } }));
import { startBrowserBroker, type BrowserBrokerHandle } from '@/process/resources/builtinMcp/browserBroker';
let broker: BrowserBrokerHandle | undefined;
const sockets: WebSocket[] = [];
afterEach(async () => {
  sockets.forEach((socket) => socket.close());
  sockets.length = 0;
  await broker?.close();
  broker = undefined;
});
async function session(id: string) {
  const response = await fetch(`http://127.0.0.1:${broker!.port}/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${broker!.token}` },
    body: JSON.stringify({ conversationId: id }),
  });
  return response.json() as Promise<{ browserUrl: string; token: string }>;
}
async function connect(endpoint: { browserUrl: string; token: string }) {
  const socket = new WebSocket(endpoint.browserUrl.replace('http:', 'ws:') + `/aionui-cdp?token=${endpoint.token}`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error('Connection failed'));
  });
  return socket;
}
function command(socket: WebSocket, method: string, params: Record<string, unknown> = {}) {
  return new Promise<{ result?: { page: number }; error?: unknown }>((resolve) => {
    socket.onmessage = (event) => {
      const value = JSON.parse(String(event.data));
      if (value.id === 1) resolve(value);
    };
    socket.send(JSON.stringify({ id: 1, method, params }));
  });
}
describe('conversation browser routing', () => {
  it('runs two conversations concurrently without retargeting either page', async () => {
    broker = await startBrowserBroker({
      getConversation: async () => ({ extra: {} }),
      skillsRoot: '.',
      requestBrowser: vi.fn(),
    });
    pages.set(1, page(1));
    pages.set(2, page(2));
    const a = await session('a'),
      b = await session('b');
    expect(a.browserUrl).not.toBe(b.browserUrl);
    await broker.attach(1, 'a');
    await broker.attach(2, 'b');
    const [sa, sb] = await Promise.all([connect(a), connect(b)]);
    const results = await Promise.all([command(sa, 'Runtime.evaluate'), command(sb, 'Runtime.evaluate')]);
    expect(results.map((value) => value.result?.page)).toEqual([1, 2]);
    expect((await command(sa, 'Page.navigate')).result?.page).toBe(1);
  });
  it('requires the broker token and refuses unowned browser attachment', async () => {
    broker = await startBrowserBroker({
      getConversation: async () => ({ extra: {} }),
      skillsRoot: '.',
      requestBrowser: vi.fn(),
    });
    const response = await fetch(`http://127.0.0.1:${broker.port}/session`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(403);
    expect((await broker.attach(1)).ok).toBe(false);
  });
  it('reloads only its owned guest, including the ignore-cache variant', async () => {
    broker = await startBrowserBroker({
      getConversation: async () => ({ extra: {} }),
      skillsRoot: '.',
      requestBrowser: vi.fn(),
    });
    const a = page(11),
      b = page(12);
    pages.set(11, a);
    pages.set(12, b);
    await broker.attach(11, 'a');
    await broker.attach(12, 'b');
    const socket = await connect(await session('a'));
    await command(socket, 'Page.reload');
    await command(socket, 'Page.reload', { ignoreCache: true });
    expect([a.reload.mock.calls.length, a.reloadIgnoringCache.mock.calls.length, b.reload.mock.calls.length]).toEqual([
      1, 1, 0,
    ]);
    expect(a.debugger.sendCommand).not.toHaveBeenCalledWith('Page.reload', expect.anything());
  });
  it('refuses missing conversations instead of falling back to a visible page', async () => {
    broker = await startBrowserBroker({
      getConversation: async () => {
        throw new Error('Conversation not found');
      },
      skillsRoot: '.',
      requestBrowser: vi.fn(),
    });
    expect(await session('missing')).toHaveProperty('error', 'Conversation not found');
  });
});
