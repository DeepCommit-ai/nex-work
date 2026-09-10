import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BackendCall } from '@/process/services/managedagents/backend';
import { prepareNexworkClaudeProfile } from '@/branding/assistants/claudeProfile';
import { prepareManagedConversation, setManagedCatalogIds } from '@/common/deptconfig/managedConversation';

/** Controlled responses exercise the real engine's tool execution, without a paid model call. */
export async function runManagedModelProbe(
  api: BackendCall,
  directory: string,
  engine: 'aion' | 'claude' = 'aion'
): Promise<void> {
  const traffic: unknown[] = [];
  const results = new Set<string>();
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || '{}');
    if (!request.url?.includes('/messages')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ input_tokens: 10 }));
      return;
    }
    const toolNames = (body.tools ?? []).map((tool: { name: string }) => tool.name) as string[];
    const blocks = (body.messages ?? []).flatMap((message: { content: unknown }) =>
      Array.isArray(message.content) ? message.content : []
    );
    const previous = blocks.filter((block: { type: string }) => block.type === 'tool_result');
    for (const block of previous) results.add(JSON.stringify(block));
    traffic.push({ system: body.system, toolNames, previous });
    const operation =
      engine === 'claude'
        ? undefined
        : previous.length === 0
          ? 'register_agent'
          : previous.length === 1
            ? 'submit_bug'
            : undefined;
    const name = operation ? toolNames.find((name) => name.endsWith(operation)) : undefined;
    const input =
      operation === 'register_agent'
        ? {
            id: 'dialogue-created',
            name: '对话创建的助手',
            rules: '帮助用户整理会议资料。',
            request_id: 'dialogue-create-001',
          }
        : { title: '来自管家的联调 Bug', description: '验证真实 Aion 工具调用。', request_id: 'dialogue-bug-001' };
    const block = name
      ? { type: 'tool_use', id: `probe_${operation}`, name, input }
      : { type: 'text', text: 'Management probe complete.' };
    const stop = name ? 'tool_use' : 'end_turn';
    const message = {
      id: 'msg_managed_probe',
      type: 'message',
      role: 'assistant',
      model: body.model || 'claude-sonnet-4-6',
      content: [block],
      stop_reason: stop,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    if (!body.stream) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(message));
      return;
    }
    const start = name ? { ...block, input: {} } : { ...block, text: '' };
    const delta = name
      ? { type: 'input_json_delta', partial_json: JSON.stringify(input) }
      : { type: 'text_delta', text: 'Management probe complete.' };
    const events = [
      ['message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: start }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 10 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    response.setHeader('Content-Type', 'text/event-stream');
    response.end(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    const provider = await api<{ id: string }>('POST', '/api/providers', {
      name: 'Local management protocol probe',
      platform: 'anthropic',
      base_url: base,
      api_key: 'local-probe-only',
      models: ['claude-sonnet-4-6'],
    });
    const servers = await api<Array<{ id: string; name: string; transport: unknown }>>('GET', '/api/mcp/servers');
    const management = servers.find((server) => server.name === 'nexwork-management')!;
    if (engine === 'claude') {
      const profile = path.join(directory, 'claude-model-profile');
      prepareNexworkClaudeProfile(profile);
      await api('PUT', '/api/agents/2d23ff1c/overrides', {
        command_override: path.resolve(
          `resources/bundled-claude/${process.platform}-${process.arch}/claude${process.platform === 'win32' ? '.exe' : ''}`
        ),
        env_override: [
          { name: 'CLAUDE_CONFIG_DIR', value: profile },
          { name: 'ANTHROPIC_BASE_URL', value: base },
          { name: 'ANTHROPIC_API_KEY', value: 'local-probe-only' },
          { name: 'ANTHROPIC_AUTH_TOKEN', value: 'local-probe-only' },
          { name: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', value: '1' },
        ],
      });
    }
    const workspace = path.join(directory, engine + '-dialogue');
    mkdirSync(workspace);
    setManagedCatalogIds(['default-assistant', 'office-assistant', 'nexwork-butler']);
    const request = await prepareManagedConversation(
      'POST',
      '/api/conversations',
      {
        assistant: {
          id: engine === 'aion' ? 'nexwork-butler' : 'office-assistant',
          locale: 'zh-CN',
          conversation_overrides: { permission: engine === 'aion' ? 'yolo' : 'bypassPermissions' },
        },
        ...(engine === 'aion' ? { model: { provider_id: provider.id, model: 'claude-sonnet-4-6' } } : {}),
        extra: { workspace },
      },
      (route) => api('GET', route)
    );
    const conversation = await api<{ id: string }>('POST', '/api/conversations', request);
    await api('POST', `/api/conversations/${conversation.id}/messages`, {
      content: '创建并注册测试助手，然后提交测试 Bug。',
    });
    for (let i = 0; i < 120 && (engine === 'aion' ? results.size < 2 : traffic.length === 0); i++) await Bun.sleep(500);
    writeFileSync(path.join(directory, engine + '-model-traffic.json'), JSON.stringify(traffic, null, 2));
    if (engine === 'claude') {
      const serialized = JSON.stringify(traffic);
      if (!serialized.includes('NexWork Office assistant') || !serialized.includes('officecli-docx-nw-'))
        throw new Error('Claude did not receive the published Office prompt and versioned skills');
      if (serialized.includes('NexWork Butler')) throw new Error('Claude received the Butler role');
      console.log('PASS: bundled Claude Code received the published Office prompt and versioned skills');
      return;
    }
    if (results.size < 2)
      throw new Error(`Native Aion did not return both management tool results (${traffic.length} model requests)`);
    if ([...results].some((result) => result.includes('"is_error":true')))
      throw new Error('Native management tool failed');
    if (!JSON.stringify(traffic).includes('NexWork Butler'))
      throw new Error('Native Aion did not receive the server-owned Butler role');
    console.log(
      'PASS: actual Aion conversation executed register_agent and submit_bug; tool results returned to model'
    );
  } finally {
    server.closeAllConnections();
    server.close();
  }
}
