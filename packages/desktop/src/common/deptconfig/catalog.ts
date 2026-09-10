/** Versioned wire contract shared with cynapse server/managed/catalog.py. */
export type ManagedSkill = { files: Record<string, string> };
export type ManagedAgent = {
  id: string;
  name: string;
  name_i18n: Record<string, string>;
  description: string;
  description_i18n: Record<string, string>;
  engine: 'claude-code' | 'aion';
  mandatory: boolean;
  rules: string;
  skills: string[];
};
export type ManagedCatalog = {
  schema_version: 1;
  common_rules: string;
  agents: ManagedAgent[];
  skills: Record<string, ManagedSkill>;
};
export type CatalogRelease = { revision: number; digest: string; content: string; published_at: number };
export type ManagedLabels = Record<string, Pick<ManagedAgent, 'name_i18n' | 'description_i18n'>>;
export type ManagedSyncStatus = {
  phase: 'idle' | 'syncing' | 'ready' | 'error' | 'unauthorized';
  push: 'disconnected' | 'connecting' | 'connected';
  version?: string;
  revision?: number;
  checkedAt?: number;
  installedAt?: number;
  error?: string;
  assistantIds: string[];
  labels?: ManagedLabels;
};
export type ManagedSyncResult = { success: boolean; status: ManagedSyncStatus; error?: string };

export const MANAGED_DEFAULT_ID = 'default-assistant';
export const MANAGED_BUTLER_ID = 'nexwork-butler';
export const MANAGED_OFFICE_ID = 'office-assistant';
export const MANAGED_CORE_IDS = [MANAGED_DEFAULT_ID, MANAGED_OFFICE_ID, MANAGED_BUTLER_ID] as const;
export const MANAGED_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const MAX_CATALOG_BYTES = 2 * 1024 * 1024;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is Record<string, string> =>
  record(value) && Object.values(value).every((v) => typeof v === 'string');

/** Validate before any filesystem or backend mutation. Hash verification belongs to the host. */
export function parseManagedCatalog(release: CatalogRelease): ManagedCatalog {
  if (
    !Number.isSafeInteger(release?.revision) ||
    release.revision < 1 ||
    !/^[a-f0-9]{64}$/.test(release.digest) ||
    typeof release.content !== 'string' ||
    new TextEncoder().encode(release.content).length > MAX_CATALOG_BYTES
  )
    throw new Error('Invalid catalog release');
  const value: unknown = JSON.parse(release.content);
  if (
    !record(value) ||
    value.schema_version !== 1 ||
    typeof value.common_rules !== 'string' ||
    !value.common_rules.trim() ||
    !Array.isArray(value.agents) ||
    value.agents.length > 500 ||
    !record(value.skills)
  )
    throw new Error('Invalid catalog shape');
  const ids = new Set<string>();
  for (const agent of value.agents) {
    if (
      !record(agent) ||
      typeof agent.id !== 'string' ||
      !MANAGED_ID_RE.test(agent.id) ||
      ids.has(agent.id) ||
      typeof agent.name !== 'string' ||
      !agent.name.trim() ||
      typeof agent.description !== 'string' ||
      !strings(agent.name_i18n) ||
      !strings(agent.description_i18n) ||
      typeof agent.rules !== 'string' ||
      agent.engine !== (agent.id === MANAGED_BUTLER_ID ? 'aion' : 'claude-code') ||
      agent.mandatory !== (agent.id === MANAGED_DEFAULT_ID) ||
      !Array.isArray(agent.skills) ||
      !agent.skills.every((name) => typeof name === 'string' && Object.hasOwn(value.skills as object, name))
    )
      throw new Error('Invalid managed assistant');
    if (agent.id === MANAGED_DEFAULT_ID && agent.rules.trim())
      throw new Error('Default assistant has a dedicated role');
    ids.add(agent.id);
  }
  if (!MANAGED_CORE_IDS.every((id) => ids.has(id))) throw new Error('A required assistant is missing');
  for (const [name, skill] of Object.entries(value.skills)) {
    if (
      !MANAGED_ID_RE.test(name) ||
      !record(skill) ||
      !strings(skill.files) ||
      !skill.files['SKILL.md']?.trim() ||
      Object.keys(skill.files).length > 100
    )
      throw new Error('Invalid managed skill');
    for (const [relative, content] of Object.entries(skill.files)) {
      if (
        !relative ||
        relative.length > 200 ||
        /[\\:]/.test(relative) ||
        relative.includes('\0') ||
        relative.split('/').some((part) => !part || part === '.' || part === '..') ||
        new TextEncoder().encode(content).length > 256 * 1024
      )
        throw new Error('Invalid managed skill file');
    }
  }
  return value as unknown as ManagedCatalog;
}
