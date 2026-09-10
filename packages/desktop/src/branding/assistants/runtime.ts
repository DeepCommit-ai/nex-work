/** Minimal bootstrap corpus. Published specialist content is installed from the configuration service. */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import upstream from './upstream.json';
import metadata from './metadata.json';
import { NEXWORK_BASE_RULES } from './prompts';
import { MANAGED_DEFAULT_ID } from '@/common/deptconfig/catalog';
import { createBackendCall } from '@process/services/managedagents/backend';
import type { Assistant } from '@/common/types/agent/assistantTypes';

type BuiltinAssistant = { id: string; name: string; default_enabled: boolean; [key: string]: unknown };
type Corpus = { manifest: { version: string; assistants: BuiltinAssistant[] }; files: Record<string, Buffer> };

/** Retain disabled legacy identities for history, without enabling the upstream catalog. */
export function buildNexworkCorpus(): Corpus {
  const encoded = JSON.parse(gunzipSync(Buffer.from(upstream.gzipBase64, 'base64')).toString()) as Record<
    string,
    string
  >;
  const files = Object.fromEntries(
    Object.entries(encoded).map(([name, value]) => [name, Buffer.from(value, 'base64')])
  );
  const manifest = JSON.parse(files['assistants.json'].toString()) as Corpus['manifest'];
  const legacy = manifest.assistants.find((a) => a.id === 'aionui-assistant');
  if (legacy) manifest.assistants.push({ ...structuredClone(legacy), id: 'nexwork-assistant' });
  for (const assistant of manifest.assistants) assistant.default_enabled = false;
  files['assistants.json'] = Buffer.from(JSON.stringify(manifest, null, 2));
  return { manifest, files };
}

/** Materialize the pinned upstream identities; managed rules never come from this corpus. */
export function prepareNexworkAssistants(dataDir: string): Record<string, string> {
  const { files } = buildNexworkCorpus();
  const digest = createHash('sha256');
  for (const [name, content] of Object.entries(files)) digest.update(name).update(content);
  const root = path.join(dataDir, 'nexwork-resources', digest.digest('hex').slice(0, 16));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid assistant resource path');
    try {
      if (readFileSync(file).equals(content)) continue;
    } catch {
      /* Materialize missing files. */
    }
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, content);
    renameSync(temporary, file);
  }
  return { AIONUI_BUILTIN_ASSISTANTS_PATH: root };
}

/** Guarantee the default entry while preserving the last server-installed catalog. */
export async function reconcileNexworkAssistants(port: number, fetchImpl: typeof fetch = fetch): Promise<void> {
  const api = createBackendCall(port, fetchImpl);
  const current = await api<Assistant[]>('GET', '/api/assistants');
  const settings = await api<Record<string, unknown>>('GET', '/api/settings/client?keys=enterprise.managedIds');
  const managed = settings['enterprise.managedIds'];
  const retained = new Set<string>(
    Array.isArray(managed) ? managed.filter((v): v is string => typeof v === 'string') : []
  );
  retained.add(MANAGED_DEFAULT_ID);
  if (!current.some((a) => a.id === MANAGED_DEFAULT_ID)) {
    await api('POST', '/api/assistants', {
      id: MANAGED_DEFAULT_ID,
      name: metadata['en-US']['default-assistant'].name,
      name_i18n: Object.fromEntries(
        Object.entries(metadata).map(([locale, value]) => [locale, value['default-assistant'].name])
      ),
      description_i18n: Object.fromEntries(
        Object.entries(metadata).map(([locale, value]) => [locale, value['default-assistant'].description])
      ),
      agent_id: '2d23ff1c',
      enabled_skills: [],
      defaults: { skills: { mode: 'fixed', value: [] } },
    });
    await api('POST', '/api/skills/assistant-rule/write', {
      assistant_id: MANAGED_DEFAULT_ID,
      content: NEXWORK_BASE_RULES,
    });
  }
  await api('PATCH', '/api/agents/2d23ff1c/enabled', { enabled: true });
  await api('PATCH', `/api/assistants/${MANAGED_DEFAULT_ID}/state`, { enabled: true, sort_order: 0 });
  for (const assistant of current) {
    if (assistant.enabled && !retained.has(assistant.id))
      await api('PATCH', `/api/assistants/${encodeURIComponent(assistant.id)}/state`, { enabled: false });
  }
  const actual = await api<Assistant[]>('GET', '/api/assistants');
  if (!actual.some((assistant) => assistant.id === MANAGED_DEFAULT_ID && assistant.enabled))
    throw new Error('The required default assistant was not enabled');
}
