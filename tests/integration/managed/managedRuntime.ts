import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import { prepareNexworkAssistants, reconcileNexworkAssistants } from '@/branding/assistants/runtime';
import { prepareNexworkSkills } from '@/branding/tools/resources';
import { createBackendCall } from '@/process/services/managedagents/backend';
import { ManagedAgentService } from '@/process/services/managedagents/ManagedAgentService';
import { installCatalog } from '@/process/services/managedagents/install';
import { runManagedModelProbe } from './managedModelProbe';
import { runManagedUiProbe } from './managedUiProbe';
import type { Assistant, AssistantDetail } from '@/common/types/agent/assistantTypes';

const root = mkdtempSync(path.join(tmpdir(), 'nexwork-managed-e2e-'));
console.log('Evidence directory:', root);
const source = path.join(root, 'catalog');
cpSync(path.resolve('../nex-agents/catalog'), source, { recursive: true });
const deptKey = 'local-managed-probe-department-key';
writeFileSync(path.join(root, 'keys.yaml'), `keys:\n  default: ${deptKey}\n`);
writeFileSync(
  path.join(root, 'gateway-keys.yaml'),
  'departments:\n  default:\n    key: sk-local-managed-gateway-probe\n'
);
const config = readFileSync('../cynapse/config/departments.yaml', 'utf8')
  .replaceAll('~/.nexwork-claude', path.join(root, 'claude-profile'))
  .replace(/^(\s+base_url:).*$/gm, '$1 http://127.0.0.1:9');
writeFileSync(path.join(root, 'departments.yaml'), config);
const children: ChildProcess[] = [];
const services: ManagedAgentService[] = [];
async function launch(command: string, args: string[], env: NodeJS.ProcessEnv, pattern: RegExp, name: string) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream!.on('data', (chunk) => {
      output += chunk;
    });
  for (let i = 0; i < 300; i++) {
    const match = output.match(pattern);
    if (match) return Number(match[1]);
    if (child.exitCode !== null) throw new Error(`${name}: ${output.slice(-4000)}`);
    await Bun.sleep(100);
  }
  throw new Error(`${name} timeout: ${output.slice(-4000)}`);
}
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await Bun.sleep(100);
  }
  throw new Error(`${label}: ${JSON.stringify(services.map((s) => s.snapshot()))}`);
}
try {
  const serverPort = await launch(
    process.env.NEXWORK_TEST_PYTHON ?? 'python3',
    [
      '-m',
      'uvicorn',
      'app:app',
      '--app-dir',
      path.resolve('../cynapse/server'),
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--no-access-log',
    ],
    {
      ...process.env,
      NEXWORK_AGENT_SOURCE_DIR: source,
      CYNAPSE_REGISTRY_DB: path.join(root, 'registry.sqlite3'),
      CYNAPSE_CONFIG_PATH: path.join(root, 'departments.yaml'),
      CYNAPSE_KEYS_PATH: path.join(root, 'keys.yaml'),
      CYNAPSE_GATEWAY_KEYS_PATH: path.join(root, 'gateway-keys.yaml'),
      CYNAPSE_REPORTS_PATH: path.join(root, 'reports.jsonl'),
    },
    /Uvicorn running on http:\/\/127\.0\.0\.1:(\d+)/,
    'cynapse'
  );
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const remote = async (route: string, body?: unknown) => {
    const response = await fetch(serverUrl + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Cynapse-Key': deptKey },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`${route} ${response.status}: ${JSON.stringify(result)}`);
    return result;
  };
  const clients = [];
  let failNextOfficeWrite = false;
  for (const name of ['employee-a', 'employee-b']) {
    const dataDir = path.join(root, name);
    mkdirSync(dataDir);
    const skillsRoot = prepareNexworkSkills(dataDir).AIONUI_BUILTIN_SKILLS_PATH;
    const port = await launch(
      path.resolve(
        `resources/bundled-aioncore/${process.platform}-${process.arch}/aioncore${process.platform === 'win32' ? '.exe' : ''}`
      ),
      ['--port', '0', '--data-dir', dataDir, '--local', '--managed-resources-mode', 'bundled'],
      {
        ...process.env,
        ...prepareNexworkAssistants(dataDir),
        AIONUI_BUILTIN_SKILLS_PATH: skillsRoot,
      },
      /AIONCORE_LISTENING .*?"port":(\d+)/,
      name
    );
    const realApi = createBackendCall(port);
    const api: typeof realApi = async (method, route, body) => {
      if (
        name === 'employee-a' &&
        failNextOfficeWrite &&
        route === '/api/skills/assistant-rule/write' &&
        (body as { assistant_id?: string })?.assistant_id === 'office-assistant'
      ) {
        failNextOfficeWrite = false;
        throw new Error('Injected local disk failure');
      }
      return realApi(method, route, body);
    };
    await reconcileNexworkAssistants(port);
    await api('PUT', '/api/agents/2d23ff1c/overrides', {
      command_override: path.resolve(
        `resources/bundled-claude/${process.platform}-${process.arch}/claude${process.platform === 'win32' ? '.exe' : ''}`
      ),
      env_override: [{ name: 'CLAUDE_CONFIG_DIR', value: path.join(root, 'claude-profile') }],
    });
    const service = new ManagedAgentService({
      backend: api,
      dataDir,
      skillsRoot,
      install: async (...args) => {
        try {
          return await installCatalog(...args);
        } catch (error) {
          console.error(error);
          writeFileSync(
            path.join(root, 'failed-details.json'),
            JSON.stringify(await api('GET', '/api/assistants/default-assistant'), null, 2)
          );
          throw error;
        }
      },
      onStatus: (s) => {
        if (s.error) console.log(name, s.error);
      },
    });
    services.push(service);
    const connected = await service.connect({ serverUrl, deptKey });
    if (!connected.success) throw new Error(JSON.stringify(connected));
    const active = (await api<Assistant[]>('GET', '/api/assistants')).filter((a) => a.enabled);
    console.log(
      name,
      'active',
      active.map((a) => ({ id: a.id, engine: a.agent_id }))
    );
    for (const agent of active) {
      const expectedAvatar =
        agent.id === 'office-assistant'
          ? 'office-documents'
          : agent.id === 'nexwork-butler'
            ? 'nexwork-logo'
            : undefined;
      if (agent.avatar !== expectedAvatar) throw new Error(`Incorrect published avatar for ${agent.id}`);
      for (const locale of [
        'zh-CN',
        'en-US',
        'ja-JP',
        'zh-TW',
        'ko-KR',
        'tr-TR',
        'ru-RU',
        'uk-UA',
        'pt-BR',
        'de-DE',
        'es-ES',
        'fr-FR',
        'fa-IR',
      ]) {
        const detail = await api<AssistantDetail>('GET', `/api/assistants/${agent.id}?locale=${locale}`);
        if (!detail.rules.content.includes('NexWork managed catalog revision 1'))
          throw new Error(`Missing installed rules ${agent.id}/${locale}`);
      }
    }
    clients.push({ api, dataDir, service });
  }
  const first = clients[0];
  const workspace = path.join(first.dataDir, 'workspace');
  mkdirSync(workspace);
  const conversation = await first.api<{ id: string }>('POST', '/api/conversations', {
    assistant: { id: 'office-assistant', locale: 'zh-CN' },
    extra: { workspace },
  });
  const db = new Database(path.join(first.dataDir, 'aionui-backend.db'), { readonly: true });
  const before = db
    .query('SELECT * FROM conversation_assistant_snapshots WHERE conversation_id=?')
    .get(conversation.id);
  writeFileSync(path.join(root, 'snapshot-before.json'), JSON.stringify(before, null, 2));
  const registered = await remote('/mcp/nexwork', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'register_agent',
      arguments: {
        id: 'research-helper',
        name: '研究助手',
        rules: '帮助整理用户提供的研究材料。',
        request_id: 'probe-register-001',
      },
    },
  });
  console.log('MCP register:', JSON.stringify(registered));
  await until(() => services.every((s) => s.snapshot().revision === 2), 'Push of registered Agent');
  const bug = await remote('/mcp/nexwork', {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'submit_bug',
      arguments: { title: '联调测试', description: '验证后台持久化。', request_id: 'probe-bug-001' },
    },
  });
  console.log('MCP bug:', JSON.stringify(bug));
  const office = path.join(source, 'office.md');
  writeFileSync(office, readFileSync(office, 'utf8') + '\n发布测试版本三。\n');
  const skill = path.join(source, 'skills/officecli-docx.md');
  writeFileSync(skill, readFileSync(skill, 'utf8') + '\n发布测试技能三。\n');
  const manifestPath = path.join(source, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { agents: Array<{ id: string; avatar?: string }> };
  manifest.agents.find((agent) => agent.id === 'default-assistant')!.avatar = 'office-documents';
  manifest.agents.find((agent) => agent.id === 'office-assistant')!.avatar = 'nexwork-logo';
  writeFileSync(manifestPath, JSON.stringify(manifest));
  failNextOfficeWrite = true;
  await remote('/registry/publish', { request_id: 'probe-publish-003' });
  await until(() => first.service.snapshot().phase === 'error', 'Injected installation failure');
  if (first.service.snapshot().revision !== 2) throw new Error('Failed installation advanced the installed revision');
  const restored = await first.api<AssistantDetail>('GET', '/api/assistants/default-assistant?locale=zh-CN');
  if (!restored.rules.content.includes('catalog revision 2')) throw new Error('Previous prompt was not restored');
  if (restored.profile.avatar) throw new Error('Rollback did not clear a newly added avatar');
  const restoredOffice = await first.api<AssistantDetail>('GET', '/api/assistants/office-assistant');
  if (restoredOffice.profile.avatar !== 'office-documents') throw new Error('Previous Office avatar was not restored');
  const recovery = await first.service.sync(true);
  if (!recovery.success) throw new Error('Installation did not recover: ' + recovery.error);
  await until(() => services.every((s) => s.snapshot().revision === 3), 'Push of prompt and skill update');
  const after = db.query('SELECT * FROM conversation_assistant_snapshots WHERE conversation_id=?').get(conversation.id);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Historical snapshot was changed');
  const workspace2 = path.join(first.dataDir, 'workspace2');
  mkdirSync(workspace2);
  const fresh = await first.api<{ id: string }>('POST', '/api/conversations', {
    assistant: { id: 'office-assistant', locale: 'zh-CN' },
    extra: { workspace: workspace2 },
  });
  const latest = db.query('SELECT * FROM conversation_assistant_snapshots WHERE conversation_id=?').get(fresh.id);
  writeFileSync(path.join(root, 'snapshot-latest.json'), JSON.stringify(latest, null, 2));
  if (!JSON.stringify(latest).includes('发布测试版本三')) throw new Error('New conversation missed current prompt');
  db.close();
  await runManagedModelProbe(first.api, root);
  await until(
    () => services.every((s) => s.snapshot().assistantIds.includes('dialogue-created')),
    'Native Butler-created Agent push'
  );
  services.forEach((s) => s.stop());
  await runManagedModelProbe(first.api, root, 'claude');
  if (process.env.NEXWORK_MANAGED_UI === '1') await runManagedUiProbe(root, serverUrl, deptKey);
  writeFileSync(
    path.join(root, 'result.json'),
    JSON.stringify({ clients: services.map((s) => s.snapshot()), registered, bug, historyPreserved: true }, null, 2)
  );
  console.log(
    'PASS: two native clients, 78 localized rules, push registration/publication, management MCP, immutable old snapshot and latest new conversation'
  );
} finally {
  services.forEach((s) => s.stop());
  for (const child of children.toReversed()) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((r) => child.once('exit', r)), Bun.sleep(3000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
}
