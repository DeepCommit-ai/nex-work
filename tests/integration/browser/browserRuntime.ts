/** Isolated Windows Electron probe: no employee profile, remote model, or K3 connection. */
import { app, BrowserWindow, webContents } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { WebSocket } from 'ws';
import { startBrowserBroker, type BrowserBrokerHandle } from '@/process/resources/builtinMcp/browserBroker';

const root = mkdtempSync(path.join(tmpdir(), 'nexwork-browser-live-'));
app.setPath('userData', path.join(root, 'electron-profile'));
app.disableHardwareAcceleration();
const evidence: Record<string, unknown> = {
  platform: process.platform,
  electron: process.versions.electron,
  checks: [],
};
const checks = evidence.checks as string[];
const timeline: unknown[] = [];
evidence.timeline = timeline;
const fail = (message: string): never => {
  throw new Error(message);
};
const check = (condition: unknown, label: string): void => {
  if (!condition) fail(label);
  checks.push(label);
  console.log('PASS:', label);
};
const waitUntil = async <T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  label: string,
  milliseconds = 15000
): Promise<T> => {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    const value = await read();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return fail('Timed out: ' + label);
};

class CdpClient {
  private id = 0;
  private pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  constructor(readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      const value = JSON.parse(String(raw));
      const pending = this.pending.get(value.id);
      if (!pending) return;
      this.pending.delete(value.id);
      if (value.error) pending.reject(new Error(value.error.message));
      else pending.resolve(value.result ?? {});
    });
    socket.on('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP connection closed'));
      this.pending.clear();
    });
  }
  async command(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.id;
    const response = new Promise<Record<string, unknown>>((resolve, reject) =>
      this.pending.set(id, { resolve, reject })
    );
    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }
  async value(expression: string): Promise<unknown> {
    const result = await this.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) fail(JSON.stringify(result.exceptionDetails));
    return (result.result as { value?: unknown })?.value;
  }
  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      this.socket.once('close', () => resolve());
      this.socket.close();
    });
  }
}

class McpClient {
  private id = 0;
  private pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  private child: ChildProcessWithoutNullStreams;
  private stderr = '';
  constructor(wrapper: string, broker: BrowserBrokerHandle, owner: string) {
    const node = process.env.NEXWORK_BROWSER_NODE;
    if (!node) fail('NEXWORK_BROWSER_NODE must select the Node runtime used for the wrapper.');
    this.child = spawn(node!, [wrapper], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        AIONUI_CDP_ACTIVE_PORT: String(broker.port),
        AIONUI_CDP_BRIDGE_TOKEN: broker.token,
        AIONUI_CONVERSATION_ID: owner,
      },
    });
    this.child.stderr.on('data', (chunk) => {
      this.stderr += String(chunk);
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      try {
        const value = JSON.parse(line),
          pending = this.pending.get(value.id);
        if (!pending) return;
        this.pending.delete(value.id);
        if (value.error) pending.reject(new Error(JSON.stringify(value.error)));
        else pending.resolve(value.result ?? {});
      } catch (error) {
        this.rejectAll(error instanceof Error ? error : new Error(String(error)));
      }
    });
    this.child.on('error', (error) => this.rejectAll(error));
    this.child.on('exit', (code) =>
      this.rejectAll(new Error(`Browser wrapper exited ${code}: ${this.stderr.slice(-3000)}`))
    );
  }
  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
  async request(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.id;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) =>
      this.pending.set(id, { resolve, reject })
    );
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return promise;
  }
  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'nexwork-local-browser-probe', version: '1' },
    });
    this.child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  }
  async call(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.request('tools/call', { name, arguments: args });
    const content = (result.content ?? []) as { type: string; text?: string }[];
    const text = content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    if (result.isError) fail(text);
    return text;
  }
  async close(): Promise<void> {
    if (this.child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => this.child.once('exit', () => resolve()));
    this.child.stdin.end();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (this.child.exitCode === null) this.child.kill();
  }
}

let win: BrowserWindow | undefined;
let broker: BrowserBrokerHandle | undefined;
const cdp: CdpClient[] = [];
const mcps: McpClient[] = [];
const hits: Record<string, number> = {};
const fixture = createServer((request, response) => {
  const page = request.url?.split('?')[0] ?? '/';
  if (page === '/A' || page === '/B') hits[page] = (hits[page] ?? 0) + 1;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(
    `<html><body><input id="field"><script>globalThis.page=${JSON.stringify(page)}; globalThis.ticks=0; setInterval(()=>ticks++,10);</script></body></html>`
  );
});

async function run(): Promise<void> {
  await app.whenReady();
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const port = (fixture.address() as { port: number }).port;
  const skillId = 'test-nw-0123456789ab',
    skillsRoot = path.join(root, 'skills', '0123456789abcdef'),
    source = path.join(skillsRoot, skillId);
  mkdirSync(source, { recursive: true });
  writeFileSync(path.join(source, 'SKILL.md'), `---\nname: ${skillId}\ndescription: Local browser probe\n---\n`);
  writeFileSync(
    path.join(source, 'helper.js'),
    'globalThis.helperLoads=(globalThis.helperLoads??0)+1; globalThis.helperMarker="引号\\\"与反斜杠\\\\";\n' +
      '// fixed local script, quotes " \\ 中文\n'.repeat(3000)
  );
  for (const id of ['a', 'b']) {
    const native = path.join(root, id, '.claude', 'skills');
    mkdirSync(native, { recursive: true });
    symlinkSync(source, path.join(native, skillId), process.platform === 'win32' ? 'junction' : 'dir');
  }
  broker = await startBrowserBroker({
    skillsRoot,
    requestBrowser: () => {},
    getConversation: async (id) => {
      if (!['a', 'b'].includes(id)) throw new Error('No such test conversation');
      return { extra: { workspace: path.join(root, id), skills: [skillId] } };
    },
  });
  win = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: { webviewTag: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.webContents.on('did-attach-webview', (_event, contents) => {
    timeline.push({ event: 'attach-webview', id: contents.id });
    contents.on('destroyed', () => timeline.push({ event: 'destroyed', id: contents.id }));
    contents.on('render-process-gone', (_event, details) =>
      timeline.push({ event: 'render-process-gone', id: contents.id, details })
    );
    contents.on('dom-ready', () => {
      timeline.push({ event: 'dom-ready', id: contents.id, url: contents.getURL() });
      const owner = contents.getURL().endsWith('/A') ? 'a' : contents.getURL().endsWith('/B') ? 'b' : undefined;
      if (owner) void broker!.attach(contents.id, owner);
    });
  });
  win.webContents.on('did-navigate', (_event, url) => timeline.push({ event: 'host-did-navigate', url }));
  const html = path.join(root, 'host.html');
  writeFileSync(
    html,
    `<html><body><input id="chat" value="employee draft"><webview id="a" partition="persist:isolated-local-test" src="http://127.0.0.1:${port}/A" style="position:fixed;left:0;top:50px;width:500px;height:400px"></webview><webview id="b" partition="persist:isolated-local-test" src="http://127.0.0.1:${port}/B" style="position:fixed;left:-10000px;top:50px;width:500px;height:400px"></webview></body></html>`
  );
  await win.loadURL(pathToFileURL(html).toString());
  const ids = await waitUntil(
    async () =>
      win!.webContents.executeJavaScript(
        `['a','b'].map(id=>{try{return document.getElementById(id).getWebContentsId()}catch{return null}})`
      ) as Promise<(number | null)[]>,
    (values) => values.every((id) => typeof id === 'number'),
    'both webview guests'
  );
  for (const id of ids)
    await waitUntil(
      async () =>
        webContents
          .fromId(id!)!
          .executeJavaScript('typeof page === "string" ? page : null')
          .catch(() => null),
      (value) => typeof value === 'string',
      'fixture page ready'
    );
  for (let i = 0; i < 2; i++) {
    const owner = ['a', 'b'][i];
    const attached = await broker.attach(ids[i]!, owner);
    check(attached.ok, `${owner} owns its browser guest`);
    const response = await fetch(`http://127.0.0.1:${broker.port}/session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${broker.token}` },
      body: JSON.stringify({ conversationId: owner }),
    });
    const endpoint = (await response.json()) as { browserUrl: string; token: string };
    const socket = new WebSocket(endpoint.browserUrl.replace('http:', 'ws:') + `/aionui-cdp?token=${endpoint.token}`);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    cdp.push(new CdpClient(socket));
  }
  await Promise.all(cdp.map((client) => client.command('Runtime.enable')));
  const owners = await Promise.all(cdp.map((client) => client.value('page')));
  check(JSON.stringify(owners) === '["/A","/B"]', 'concurrent evaluations stay in their own conversation');
  await cdp[0].value('document.cookie="shared=local-fixture; path=/"; true');
  check(String(await cdp[1].value('document.cookie')).includes('shared=local-fixture'), 'separate pages share cookies');
  await win.webContents.executeJavaScript('document.getElementById("chat").focus(); true');
  await Promise.all(cdp.map((client) => client.value('document.getElementById("field").focus(); true')));
  await Promise.all([
    cdp[0].command('Input.insertText', { text: 'A-输入' }),
    cdp[1].command('Input.insertText', { text: 'B-输入' }),
  ]);
  const inputs = await Promise.all(cdp.map((client) => client.value('document.getElementById("field").value')));
  evidence.inputs = inputs;
  check(JSON.stringify(inputs) === '["A-输入","B-输入"]', 'parallel keyboard input reaches both owned pages');
  const host = await win.webContents.executeJavaScript(
    '({value:document.getElementById("chat").value, focus:document.activeElement.id})'
  );
  evidence.host = host;
  check(host.value === 'employee draft' && host.focus === 'chat', 'host draft and focus are preserved');
  await waitUntil(
    async () => Promise.all(cdp.map((client) => client.value('ticks'))),
    (values) => values.every((value) => Number(value) >= 5),
    'background counters continue'
  );
  await win.webContents.executeJavaScript(
    'document.getElementById("a").style.left="-10000px"; document.getElementById("b").style.left="0px"; true'
  );
  const afterSwitch = await Promise.all(
    cdp.map((client) => client.value('({page,ticks,value:document.getElementById("field").value})'))
  );
  evidence.afterSwitch = afterSwitch;
  evidence.navigationHits = { ...hits };
  check(hits['/A'] === 1 && hits['/B'] === 1, 'switching visibility does not reload either page');
  const rawNavigation = process.env.NEXWORK_BROWSER_RAW_NAV;
  if (rawNavigation) {
    const before = { ...hits };
    timeline.push({ event: 'raw-navigation', method: rawNavigation });
    if (rawNavigation === 'reload')
      await cdp[0].command('Page.reload').catch((error: unknown) => {
        evidence.rawError = String(error);
      });
    else if (rawNavigation === 'native-reload') webContents.fromId(ids[0]!)!.reload();
    else if (rawNavigation === 'native-navigate')
      await webContents.fromId(ids[0]!)!.loadURL(`http://127.0.0.1:${port}/A?next=1`);
    else
      await cdp[0].command('Page.navigate', { url: `http://127.0.0.1:${port}/A?next=1` }).catch((error: unknown) => {
        evidence.rawError = String(error);
      });
    await waitUntil(
      async () => hits['/A'],
      (count) => count > before['/A'],
      'a navigation'
    );
    // A host reload recreates both guests; wait for its completion before asserting.
    await new Promise((resolve) => setTimeout(resolve, 250));
    evidence.rawNavigation = rawNavigation;
    evidence.navigationAfter = { ...hits };
    check(hits['/B'] === before['/B'], `${rawNavigation} touches a only`);
    evidence.success = true;
    return;
  }
  await Promise.all(cdp.splice(0).map((client) => client.close()));
  const wrapper = process.env.NEXWORK_BROWSER_WRAPPER;
  if (!wrapper) fail('NEXWORK_BROWSER_WRAPPER must select the built browserServer entry.');
  for (const owner of ['a', 'b']) {
    const client = new McpClient(wrapper!, broker, owner);
    mcps.push(client);
    await client.initialize();
  }
  const tools = await mcps[0].request('tools/list');
  check(
    (tools.tools as { name: string }[]).some((tool) => tool.name === 'inject_managed_script'),
    'actual browser wrapper advertises file injection'
  );
  const request = { skillId, relativePath: 'helper.js' };
  evidence.toolArgumentBytes = Buffer.byteLength(JSON.stringify(request));
  const injectionStarted = Date.now();
  const loaded = await Promise.all(mcps.map((client) => client.call('inject_managed_script', request)));
  evidence.firstInjectionMs = Date.now() - injectionStarted;
  check(
    loaded.every((text) => text.includes('"loaded"')),
    'actual upstream browser tool injects large local files into both pages'
  );
  const cached = await mcps[0].call('inject_managed_script', request);
  check(cached.includes('"cached"'), 'same-page repeated injection uses the content cache');
  const values = await Promise.all(
    mcps.map((client) => client.call('evaluate_script', { function: '() => ({page, helperLoads})' }))
  );
  evidence.mcpValues = values;
  check(
    values[0].includes('/A') && values[1].includes('/B') && values.every((text) => text.includes('"helperLoads":1')),
    'MCP conversations keep independent helper state'
  );
  const rejected = await mcps[0].request('tools/call', {
    name: 'inject_managed_script',
    arguments: { skillId, relativePath: '../outside.js' },
  });
  check(rejected.isError === true, 'file injection rejects an escaping path');
  const missing = await mcps[0].request('tools/call', {
    name: 'inject_managed_script',
    arguments: { skillId, relativePath: 'missing.js' },
  });
  check(missing.isError === true, 'missing managed files return an explicit tool error');
  writeFileSync(
    path.join(source, 'helper.js'),
    'globalThis.helperLoads=(globalThis.helperLoads??0)+1; globalThis.updated=true;'
  );
  const updated = await mcps[0].call('inject_managed_script', request);
  check(updated.includes('"loaded"'), 'changed script content invalidates the page cache');
  const beforeReload = { ...hits };
  const hostNavigationsBefore = timeline.filter(
    (entry) => (entry as { event: string }).event === 'host-did-navigate'
  ).length;
  console.log('Reloading a through upstream MCP');
  const reloadResult = await mcps[0].call('navigate_page', { type: 'reload' });
  evidence.reloadResult = reloadResult;
  console.log('Reload navigation returned');
  check(!reloadResult.includes('Unable to'), 'upstream reload completes without a detached-frame error');
  check(
    hits['/A'] === beforeReload['/A'] + 1 && hits['/B'] === beforeReload['/B'],
    'reloading a refreshes only a exactly once'
  );
  check(
    timeline.filter((entry) => (entry as { event: string }).event === 'host-did-navigate').length ===
      hostNavigationsBefore,
    'guest reload never reloads the host'
  );
  const reloaded = await mcps[0].call('inject_managed_script', request);
  check(reloaded.includes('"loaded"'), 'navigation reloads the helper without retranscribing source');
  const finalValues = await Promise.all(
    mcps.map((client) =>
      client.call('evaluate_script', { function: '() => ({page, helperLoads, updated:!!globalThis.updated})' })
    )
  );
  evidence.finalValues = finalValues;
  check(
    finalValues[0].includes('"updated":true') &&
      finalValues[1].includes('"updated":false') &&
      finalValues.every((value) => value.includes('"helperLoads":1')),
    'reload restores a helper while preserving b task state'
  );
  evidence.success = true;
}

const watchdog = setTimeout(() => {
  console.error('Browser runtime probe watchdog expired');
  app.exit(1);
}, 150000);
void run()
  .catch((error: unknown) => {
    evidence.success = false;
    evidence.error = error instanceof Error ? error.stack : String(error);
    console.error(evidence.error);
    process.exitCode = 1;
  })
  .finally(async () => {
    timeline.push({ event: 'cleanup' });
    await Promise.all(mcps.map((client) => client.close()));
    await Promise.all(cdp.map((client) => client.close()));
    await broker?.close();
    win?.destroy();
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    clearTimeout(watchdog);
    writeFileSync(path.join(root, 'result.json'), JSON.stringify(evidence, null, 2));
    console.log('Browser evidence:', root);
    app.exit(process.exitCode ?? 0);
  });
