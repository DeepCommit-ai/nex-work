import http from 'node:http';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BackendCall } from '@/process/services/managedagents/backend';
import { prepareNexworkClaudeProfile } from '@/branding/assistants/claudeProfile';
import { prepareManagedConversation, setManagedCatalogIds } from '@/common/deptconfig/managedConversation';
import { makeUnavailableSkillMount } from './managedSkillMountProbe';

/** A stale native CLI must resume the same conversation after recovering a broken skill mount. */
export async function runManagedWarmSkillProbe(
  api: BackendCall,
  directory: string,
  prepareRuntime: (id: string) => Promise<number>
): Promise<void> {
  if (process.platform !== 'win32') throw new Error('The warm mount probe requires Windows.');
  let turn = 1;
  let skill = '';
  const results = new Map<number, unknown[]>();
  const traffic: { turn: number; previous: unknown[]; hasFirstTurn: boolean }[] = [];
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || '{}');
    if (!request.url?.includes('/messages')) {
      response.setHeader('Content-Type', 'application/json');
      response.end('{"input_tokens":10}');
      return;
    }
    const blocks = (body.messages ?? []).flatMap((message: { content: unknown }) =>
      Array.isArray(message.content) ? message.content : []
    );
    const previous = blocks.filter((block: { type: string }) => block.type === 'tool_result');
    const identifier = `warm_probe_${turn}`;
    const matched = previous.filter((block: { tool_use_id?: string }) => block.tool_use_id === identifier);
    if (matched.length) results.set(turn, matched);
    traffic.push({ turn, previous, hasFirstTurn: JSON.stringify(body.messages).includes('warm-probe-turn-1') });
    const tool = matched.length === 0;
    const block = tool
      ? { type: 'tool_use', id: identifier, name: 'Skill', input: { skill } }
      : { type: 'text', text: `Warm skill turn ${turn} complete.` };
    const stop = tool ? 'tool_use' : 'end_turn';
    const message = {
      id: `msg_warm_probe_${turn}`,
      type: 'message',
      role: 'assistant',
      model: body.model,
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
    const start = tool ? { ...block, input: {} } : { ...block, text: '' };
    const delta = tool
      ? { type: 'input_json_delta', partial_json: JSON.stringify({ skill }) }
      : { type: 'text_delta', text: `Warm skill turn ${turn} complete.` };
    const events = [
      ['message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: start }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 10 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    response.setHeader('Content-Type', 'text/event-stream');
    response.end(events.map(([event, value]) => `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`).join(''));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const until = async (check: () => Promise<boolean>, label: string): Promise<void> => {
    for (let i = 0; i < 120; i++) {
      if (await check()) return;
      await Bun.sleep(250);
    }
    throw new Error('Warm skill probe timed out: ' + label);
  };
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const profile = path.join(directory, 'warm-skill-runtime-profile');
    prepareNexworkClaudeProfile(profile);
    await api('PUT', '/api/agents/2d23ff1c/overrides', {
      command_override: path.resolve('resources/bundled-claude/win32-x64/claude.exe'),
      env_override: [
        { name: 'CLAUDE_CONFIG_DIR', value: profile },
        { name: 'ANTHROPIC_BASE_URL', value: base },
        { name: 'ANTHROPIC_API_KEY', value: 'local-probe-only' },
        { name: 'ANTHROPIC_AUTH_TOKEN', value: 'local-probe-only' },
        { name: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', value: '1' },
      ],
    });
    setManagedCatalogIds(['default-assistant', 'office-assistant', 'nexwork-butler']);
    const request = await prepareManagedConversation(
      'POST',
      '/api/conversations',
      {
        assistant: {
          id: 'office-assistant',
          locale: 'zh-CN',
          conversation_overrides: { permission: 'bypassPermissions' },
        },
        extra: {},
      },
      (route) => api('GET', route)
    );
    const conversation = await api<{ id: string; extra: { workspace: string; skills: string[] } }>(
      'POST',
      '/api/conversations',
      request
    );
    skill = conversation.extra.skills.find((name) => name.startsWith('officecli-docx-nw-')) ?? '';
    if (!skill) throw new Error('The warm probe has no published Office skill.');
    makeUnavailableSkillMount(conversation.extra.workspace);
    // Deliberately bypass desktop preflight so the first live CLI caches the missing skill.
    await api('POST', `/api/conversations/${conversation.id}/messages`, { content: 'warm-probe-turn-1' });
    await until(async () => results.has(1), 'first Skill result');
    if (!JSON.stringify(results.get(1)).includes('Unknown skill'))
      throw new Error('First turn did not reproduce Unknown skill.');
    await until(async () => {
      const detail = await api<{
        runtime?: { state?: string; has_task?: boolean; is_processing?: boolean; pending_confirmations?: number };
      }>('GET', `/api/conversations/${conversation.id}`);
      return (
        detail.runtime?.has_task === true &&
        detail.runtime.state === 'idle' &&
        detail.runtime.is_processing === false &&
        !detail.runtime.pending_confirmations
      );
    }, 'cached native runtime becomes idle');
    const before = await api<{ items: { id: string }[] }>('GET', `/api/conversations/${conversation.id}/messages`);
    const repaired = await prepareRuntime(conversation.id);
    if (repaired < 1) throw new Error('Warm preflight did not repair the broken native mount.');
    turn = 2;
    await api('POST', `/api/conversations/${conversation.id}/messages`, { content: 'warm-probe-turn-2' });
    await until(async () => results.has(2), 'second Skill result');
    if (
      !JSON.stringify(results.get(2)).includes(`Launching skill: ${skill}`) ||
      JSON.stringify(results.get(2)).includes('"is_error":true')
    )
      throw new Error('Repaired warm runtime still failed Skill invocation: ' + JSON.stringify(results.get(2)));
    if (!traffic.some((entry) => entry.turn === 2 && entry.hasFirstTurn))
      throw new Error('Restart lost the original native conversation history.');
    const after = await api<{ items: { id: string }[] }>('GET', `/api/conversations/${conversation.id}/messages`);
    if (!before.items.length || !before.items.every((message) => after.items.some((item) => item.id === message.id)))
      throw new Error('Restart removed a persisted conversation message.');
    writeFileSync(
      path.join(directory, 'warm-skill-result.json'),
      JSON.stringify(
        {
          conversationId: conversation.id,
          repaired,
          first: results.get(1),
          second: results.get(2),
          nativeHistoryPreserved: true,
          messagesBefore: before,
          messagesAfter: after,
          traffic,
        },
        null,
        2
      )
    );
    console.log(
      'PASS: same native conversation Unknown skill -> repair/restart -> Skill Launching; original native history preserved'
    );
  } finally {
    writeFileSync(path.join(directory, 'warm-skill-traffic.json'), JSON.stringify(traffic, null, 2));
    server.closeAllConnections();
    server.close();
  }
}
