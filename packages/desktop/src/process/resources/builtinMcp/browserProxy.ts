import { managedScriptFunction, type ManagedScriptRequest } from './managedScript';

type Message = {
  id?: string | number;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
  result?: { tools?: unknown[] };
};
const tool = {
  name: 'inject_managed_script',
  description:
    'Load a selected managed skill JavaScript file into this conversation browser. Pass only the skill ID and relative path, never copy its source into evaluate_script. Repeated calls reuse the content-hash cache until navigation or a file version change.',
  inputSchema: {
    type: 'object',
    properties: { skillId: { type: 'string' }, relativePath: { type: 'string' } },
    required: ['skillId', 'relativePath'],
    additionalProperties: false,
  },
};

/** Augment the upstream stdio protocol without changing its request IDs or browser connection. */
export function createBrowserProxy(load: (input: ManagedScriptRequest) => Promise<{ source: string; sha256: string }>) {
  const lists = new Set<string | number>();
  return {
    async request(line: string): Promise<string> {
      const message = JSON.parse(line) as Message;
      if (message.method === 'tools/list' && message.id !== undefined) lists.add(message.id);
      if (message.method !== 'tools/call' || message.params?.name !== tool.name) return line;
      const input = message.params.arguments ?? {};
      if (typeof input.skillId !== 'string' || typeof input.relativePath !== 'string')
        throw new Error('skillId and relativePath are required.');
      const script = await load({ skillId: input.skillId, relativePath: input.relativePath });
      return JSON.stringify({
        ...message,
        params: {
          name: 'evaluate_script',
          arguments: { function: managedScriptFunction(script, `${input.skillId}/${input.relativePath}`) },
        },
      });
    },
    response(line: string): string {
      const message = JSON.parse(line) as Message;
      if (message.id !== undefined && lists.delete(message.id) && message.result?.tools)
        return JSON.stringify({ ...message, result: { ...message.result, tools: [...message.result.tools, tool] } });
      return line;
    },
  };
}
