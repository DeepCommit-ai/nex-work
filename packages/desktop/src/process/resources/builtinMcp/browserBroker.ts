import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { startCdpBridge, type CdpBridgeHandle } from './cdpBridge';
import { tokensMatch } from './cdpTargetProtocol';
import { readManagedScript, type ManagedScriptRequest } from './managedScript';

type Conversation = { extra?: { workspace?: string; skills?: string[] } };
export type BrowserBrokerHandle = {
  port: number;
  token: string;
  attach: (webContentsId: number, conversationId?: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  release: (conversationId: string) => Promise<void>;
  close: () => Promise<void>;
};

/** A private CDP endpoint per conversation, sharing only Electron's cookie partition. */
export async function startBrowserBroker(options: {
  requestBrowser: (conversationId: string) => void;
  getConversation: (id: string) => Promise<Conversation>;
  skillsRoot: string;
}): Promise<BrowserBrokerHandle> {
  const token = randomBytes(24).toString('hex');
  const sessions = new Map<string, Promise<CdpBridgeHandle>>();
  const ensure = async (id: string): Promise<CdpBridgeHandle> => {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('A valid conversation identity is required.');
    await options.getConversation(id);
    let pending = sessions.get(id);
    if (!pending) {
      pending = startCdpBridge(() => options.requestBrowser(id), { preserveHostFocus: true });
      sessions.set(id, pending);
      pending.catch(() => {
        if (sessions.get(id) === pending) sessions.delete(id);
      });
    }
    return pending;
  };
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !tokensMatch(req.headers.authorization?.replace(/^Bearer /, '') ?? '', token)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) throw new Error('Request too large.');
        chunks.push(Buffer.from(chunk));
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ManagedScriptRequest & {
        conversationId: string;
      };
      if (req.url === '/session') {
        const bridge = await ensure(input.conversationId);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ browserUrl: `http://127.0.0.1:${bridge.port}`, token: bridge.token }));
      } else if (req.url === '/script') {
        if (!sessions.has(input.conversationId)) throw new Error('The browser conversation has not been initialized.');
        const conversation = await options.getConversation(input.conversationId);
        const workspace = conversation.extra?.workspace;
        if (!workspace) throw new Error('Conversation workspace is unavailable.');
        const script = await readManagedScript(input, {
          workspace,
          selectedSkills: conversation.extra?.skills ?? [],
          skillsRoot: options.skillsRoot,
        });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(script));
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const release = async (id: string): Promise<void> => {
    const session = sessions.get(id);
    if (session) {
      sessions.delete(id);
      await (await session).close();
    }
  };
  return {
    port: (server.address() as { port: number }).port,
    token,
    attach: async (webContentsId, conversationId) => {
      if (!conversationId) return { ok: false, reason: 'A browser must belong to a conversation.' };
      return (await ensure(conversationId)).attach(webContentsId);
    },
    release,
    close: async () => {
      await Promise.all([...sessions.keys()].map(release));
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
