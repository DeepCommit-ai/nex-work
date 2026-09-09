/** Node-only materialization of the versioned NexWork assistant resources. */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BRAND_COLOR_INK, BRAND_COLOR_CREAM } from '../constants';
import upstream from './upstream.json';
import metadata from './metadata.json';
import { NEXWORK_ASSISTANT_RULES } from './prompts';
import { isNexworkAssistant, LEGACY_ASSISTANT_ID, NEXWORK_ASSISTANT_ID, NEXWORK_ASSISTANT_IDS } from './policy';

type BuiltinAssistant = {
  id: string;
  name: string;
  default_enabled: boolean;
  [key: string]: unknown;
};
type Corpus = { manifest: { version: string; assistants: BuiltinAssistant[] }; files: Record<string, Buffer> };

/** Build a complete catalog while retaining disabled upstream records and assets. */
export function buildNexworkCorpus(): Corpus {
  const encoded = JSON.parse(gunzipSync(Buffer.from(upstream.gzipBase64, 'base64')).toString()) as Record<
    string,
    string
  >;
  const files = Object.fromEntries(
    Object.entries(encoded).map(([name, value]) => [name, Buffer.from(value, 'base64')])
  );
  const manifest = JSON.parse(files['assistants.json'].toString()) as Corpus['manifest'];
  const legacy = manifest.assistants.find((assistant) => assistant.id === LEGACY_ASSISTANT_ID);
  if (!legacy) throw new Error('NexWork assistant resource baseline is incomplete');
  manifest.assistants.push({ ...structuredClone(legacy), id: NEXWORK_ASSISTANT_ID });
  for (const assistant of manifest.assistants) {
    assistant.default_enabled = isNexworkAssistant(assistant.id);
    const id = assistant.id === LEGACY_ASSISTANT_ID ? NEXWORK_ASSISTANT_ID : assistant.id;
    if (!isNexworkAssistant(id)) continue;
    const key = id as keyof (typeof metadata)['en-US'];
    const copy = metadata['en-US'][key];
    assistant.name = copy.name;
    assistant.description = copy.description;
    assistant.name_i18n = Object.fromEntries(
      Object.entries(metadata).map(([locale, values]) => [locale, values[key].name])
    );
    assistant.description_i18n = Object.fromEntries(
      Object.entries(metadata).map(([locale, values]) => [locale, values[key].description])
    );
    assistant.disabled_builtin_skills = ['aionui-config'];
    if (id !== NEXWORK_ASSISTANT_ID) assistant.agent_ref = '2d23ff1c';
    assistant.rule_file = `rules/${id}.{locale}.md`;
    if (id === NEXWORK_ASSISTANT_ID) {
      assistant.sort_order = 0;
      assistant.avatar = 'avatars/nexwork-assistant.svg';
      assistant.enabled_skills = [];
      assistant.prompts = copy.prompts;
      assistant.prompts_i18n = Object.fromEntries(
        Object.entries(metadata).map(([locale, values]) => [locale, values[key].prompts])
      );
    }
    for (const locale of Object.keys(metadata)) {
      files[`rules/${id}.${locale}.md`] = Buffer.from(NEXWORK_ASSISTANT_RULES[id]);
      // Existing conversations can still reference the disabled legacy identity.
      if (assistant.id === LEGACY_ASSISTANT_ID)
        files[`rules/${LEGACY_ASSISTANT_ID}.${locale}.md`] = files[`rules/${id}.${locale}.md`];
    }
  }
  files['avatars/nexwork-assistant.svg'] = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${BRAND_COLOR_INK}"/><g fill="${BRAND_COLOR_CREAM}" stroke="${BRAND_COLOR_CREAM}" stroke-width="5"><path fill="none" d="M17 16 31 32 17 50M31 32 50 36"/><circle cx="17" cy="16" r="5"/><circle cx="31" cy="32" r="5"/><circle cx="17" cy="50" r="5"/><circle cx="50" cy="36" r="5"/></g></svg>`
  );
  files['assistants.json'] = Buffer.from(JSON.stringify(manifest, null, 2));
  return { manifest, files };
}

/** Write embedded resources before backend bootstrap; never fall back to old branding. */
export function prepareNexworkAssistants(dataDir: string): Record<string, string> {
  const { files } = buildNexworkCorpus();
  const digest = createHash('sha256');
  for (const [name, content] of Object.entries(files)) digest.update(name).update(content);
  const root = path.join(dataDir, 'nexwork-resources', digest.digest('hex').slice(0, 16));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    if (!target.startsWith(root + path.sep)) throw new Error('Invalid NexWork resource path');
    try {
      if (readFileSync(target).equals(content)) continue;
    } catch {
      /* Create or repair a missing resource. */
    }
    mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, content);
    renameSync(temporary, target);
  }
  return { AIONUI_BUILTIN_ASSISTANTS_PATH: root };
}

type AssistantState = { id: string; enabled: boolean };

/** Enforce and read back the four-assistant set on every backend start. */
export async function reconcileNexworkAssistants(port: number, fetchImpl: typeof fetch = fetch): Promise<void> {
  const base = `http://127.0.0.1:${port}/api/assistants`;
  const list = async (): Promise<AssistantState[]> => {
    const response = await fetchImpl(base);
    if (!response.ok) throw new Error(`Cannot read NexWork assistants (${response.status})`);
    const payload = (await response.json()) as { success?: boolean; data?: AssistantState[] };
    if (payload.success !== true || !Array.isArray(payload.data)) throw new Error('Invalid NexWork assistant catalog');
    return payload.data;
  };
  const current = await list();
  for (const id of NEXWORK_ASSISTANT_IDS) {
    if (!current.some((assistant) => assistant.id === id)) throw new Error(`Missing NexWork assistant: ${id}`);
  }
  // Enable the retained set first; never delete an assistant or its conversations.
  const ordered = [...current].toSorted(
    (left, right) => Number(isNexworkAssistant(right.id)) - Number(isNexworkAssistant(left.id))
  );
  for (const assistant of ordered) {
    const enabled = isNexworkAssistant(assistant.id);
    if (assistant.enabled === enabled) continue;
    const response = await fetchImpl(`${base}/${encodeURIComponent(assistant.id)}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) throw new Error(`Cannot reconcile assistant ${assistant.id} (${response.status})`);
  }
  const actual = (await list())
    .filter((assistant) => assistant.enabled)
    .map((assistant) => assistant.id)
    .toSorted();
  if (JSON.stringify(actual) !== JSON.stringify([...NEXWORK_ASSISTANT_IDS].toSorted()))
    throw new Error('NexWork assistant state did not converge');
}
