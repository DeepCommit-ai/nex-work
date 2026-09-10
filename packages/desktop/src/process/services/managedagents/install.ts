/** Apply a published catalog through local APIs, with immutable skill files and rollback. */
import path from 'node:path';
import os from 'node:os';
import type { Assistant, AssistantDetail, CreateAssistantRequest } from '@/common/types/agent/assistantTypes';
import type { IMcpServer } from '@/common/config/storage';
import type { DeptConfig } from '@/common/deptconfig/types';
import type { ManagedCatalog } from '@/common/deptconfig/catalog';
import { MANAGED_BUTLER_ID, MANAGED_DEFAULT_ID } from '@/common/deptconfig/catalog';
import { buildEnvOverride, expandLeadingTilde } from '@/common/gateway/provisionGateway';
import { buildProvenanceEnvValue } from '@/common/deptconfig/client';
import type { EnvEntry } from '@/common/gateway/types';
import i18nConfig from '@/common/config/i18n-config.json';
import { prepareNexworkClaudeProfile } from '@/branding/assistants/claudeProfile';
import { composeManagedRules, installManagedSkills } from './files';
import type { BackendCall } from './backend';

export type InstallOptions = {
  backend: BackendCall;
  skillsRoot: string;
  serverUrl: string;
  deptKey: string;
  clientId: string;
  prepareClaude?: (directory: string) => void;
  locales?: string[];
};
type Backup = { detail: AssistantDetail; rules: Record<string, string> };
type Undo = () => Promise<unknown>;

export class CatalogRestorationError extends Error {}

const restoreBody = (d: AssistantDetail): CreateAssistantRequest => ({
  ...d.profile,
  agent_id: d.engine.agent_id,
  enabled_skills: d.capabilities.default_skill_ids ?? [],
  custom_skill_names: d.capabilities.custom_skill_names ?? [],
  disabled_builtin_skills: d.capabilities.default_disabled_builtin_skill_ids ?? [],
  defaults: d.defaults,
  recommended_prompts: d.prompts.recommended,
  recommended_prompts_i18n: d.prompts.recommended_i18n,
});

/** Preserve local command overrides while applying the server's supported engines and gateway. */
export async function provisionGateway(cfg: DeptConfig, options: InstallOptions, undo: Undo[] = []): Promise<void> {
  const api = options.backend;
  const gateway = cfg.gateway!;
  const agents = await api<Array<{ id: string; enabled: boolean }>>('GET', '/api/agents/management');
  for (const agent of agents) {
    const enabled = cfg.agents.includes(agent.id);
    if (agent.enabled === enabled) continue;
    undo.push(() => api('PATCH', `/api/agents/${encodeURIComponent(agent.id)}/enabled`, { enabled: agent.enabled }));
    await api('PATCH', `/api/agents/${encodeURIComponent(agent.id)}/enabled`, { enabled });
  }
  const providers = await api<Array<{ id: string; name: string; [key: string]: unknown }>>('GET', '/api/providers');
  const provider = providers.find((p) => p.name === 'NexWork Gateway');
  const providerBody = {
    name: 'NexWork Gateway',
    platform: 'custom',
    base_url: gateway.base_url,
    api_key: gateway.api_key,
    models: cfg.model_aliases,
  };
  const overrides = await api<{ command_override?: string | null; env_override?: EnvEntry[] }>(
    'GET',
    '/api/agents/2d23ff1c/overrides'
  );
  const existing = overrides.env_override ?? [];
  const configDir = expandLeadingTilde(
    gateway.config_dir ||
      existing.find((v) => v.name === 'CLAUDE_CONFIG_DIR')?.value ||
      path.join(os.homedir(), '.nexwork-claude'),
    os.homedir()
  );
  (options.prepareClaude ?? prepareNexworkClaudeProfile)(configDir);
  if (provider) {
    undo.push(() => api('PUT', `/api/providers/${provider.id}`, provider));
    await api('PUT', `/api/providers/${provider.id}`, providerBody);
  } else {
    const saved = await api<{ id: string }>('POST', '/api/providers', providerBody);
    undo.push(() => api('DELETE', `/api/providers/${saved.id}`));
  }
  const env = buildEnvOverride(existing, {
    baseUrl: gateway.base_url,
    apiKey: gateway.api_key,
    configDir,
    customHeadersValue: buildProvenanceEnvValue({
      dept: cfg.dept,
      configVersion: cfg.version,
      clientId: options.clientId,
    }),
  });
  undo.push(() => api('PUT', '/api/agents/2d23ff1c/overrides', overrides));
  await api('PUT', '/api/agents/2d23ff1c/overrides', {
    command_override: overrides.command_override ?? null,
    env_override: env,
  });
}

async function provisionManagement(options: InstallOptions, undo: Undo[]): Promise<IMcpServer[]> {
  const api = options.backend;
  const servers = await api<IMcpServer[]>('GET', '/api/mcp/servers');
  const current = servers.find((server) => server.name === 'nexwork-management');
  const transport = {
    type: 'http',
    url: `${options.serverUrl}/mcp/nexwork`,
    headers: { 'X-Cynapse-Key': options.deptKey },
  };
  const body = {
    name: 'nexwork-management',
    description: 'NexWork management',
    transport,
    original_json: JSON.stringify({ mcpServers: { 'nexwork-management': transport } }),
    builtin: true,
  };
  if (current) undo.push(() => api('PUT', `/api/mcp/servers/${current.id}`, current));
  let saved = current
    ? await api<IMcpServer>('PUT', `/api/mcp/servers/${current.id}`, body)
    : await api<IMcpServer>('POST', '/api/mcp/servers', body);
  const savedId = saved.id;
  if (!current) undo.push(() => api('DELETE', `/api/mcp/servers/${savedId}`));
  if (!saved.enabled) {
    if (current) undo.push(() => api('POST', `/api/mcp/servers/${savedId}/toggle`));
    saved = await api<IMcpServer>('POST', `/api/mcp/servers/${savedId}/toggle`);
  }
  return [...servers.filter((server) => server.id !== saved.id), saved];
}

/** Prepare all files before changing assistants. Never modify conversation snapshots or workspaces. */
export async function installCatalog(
  cfg: DeptConfig,
  catalog: ManagedCatalog,
  options: InstallOptions
): Promise<string[]> {
  const api = options.backend;
  const locales = options.locales ?? i18nConfig.supportedLanguages;
  const names = installManagedSkills(options.skillsRoot, catalog);
  const before = await api<Assistant[]>('GET', '/api/assistants');
  const previous = new Map<string, Backup>();
  for (const agent of catalog.agents) {
    if (!before.some((a) => a.id === agent.id)) continue;
    const detail = await api<AssistantDetail>('GET', `/api/assistants/${agent.id}`);
    const rules: Record<string, string> = {};
    for (const locale of locales) {
      rules[locale] = (await api<AssistantDetail>('GET', `/api/assistants/${agent.id}?locale=${locale}`)).rules.content;
    }
    previous.set(agent.id, { detail, rules });
  }
  const created: string[] = [];
  const changed: string[] = [];
  const undo: Undo[] = [];
  try {
    await provisionGateway(cfg, options, undo);
    const servers = await provisionManagement(options, undo);
    const commonMcps = servers.filter((s) => s.enabled && s.name !== 'nexwork-management').map((s) => s.id);
    const managementId = servers.find((s) => s.name === 'nexwork-management')!.id;
    for (const agent of catalog.agents) {
      const old = previous.get(agent.id)?.detail;
      const spec = cfg.assistants.find((a) => a.id === agent.id);
      const skills = agent.skills.map((name) => names[name]);
      const body: CreateAssistantRequest = {
        id: agent.id,
        name: agent.name,
        name_i18n: agent.name_i18n,
        description: agent.description,
        description_i18n: agent.description_i18n,
        agent_id: agent.engine === 'aion' ? '632f31d2' : '2d23ff1c',
        enabled_skills: skills,
        custom_skill_names: [],
        disabled_builtin_skills: ['aionui-config', 'nexwork-config'],
        recommended_prompts: [],
        recommended_prompts_i18n: {},
        defaults: {
          ...old?.defaults,
          skills: { mode: 'fixed', value: skills },
          mcps: { mode: 'fixed', value: agent.id === MANAGED_BUTLER_ID ? [...commonMcps, managementId] : commonMcps },
          ...(spec?.fixed_model ? { model: { mode: 'fixed', value: spec.fixed_model } } : {}),
        },
      };
      if (old) {
        changed.push(agent.id);
        await api('PUT', `/api/assistants/${agent.id}`, body);
      } else {
        await api('POST', '/api/assistants', body);
        created.push(agent.id);
      }
      const rules = composeManagedRules(catalog, agent.rules, names, cfg.agent_catalog!.revision);
      for (const locale of locales) {
        await api('POST', '/api/skills/assistant-rule/write', { assistant_id: agent.id, locale, content: rules });
      }
      await api('PATCH', `/api/assistants/${agent.id}/state`, {
        enabled: agent.id === MANAGED_DEFAULT_ID || (old?.state.enabled ?? true),
        sort_order: catalog.agents.indexOf(agent),
      });
    }
    const wanted = new Set(catalog.agents.map((a) => a.id));
    for (const old of before) {
      if (old.enabled && !wanted.has(old.id))
        await api('PATCH', `/api/assistants/${encodeURIComponent(old.id)}/state`, { enabled: false });
    }
    // A successful response is insufficient: read the actual rules and mounted skills back.
    for (const agent of catalog.agents) {
      const detail = await api<AssistantDetail>('GET', `/api/assistants/${agent.id}?locale=${locales[0]}`);
      const expectedRules = composeManagedRules(catalog, agent.rules, names, cfg.agent_catalog!.revision);
      if (
        detail.rules.content !== expectedRules ||
        detail.engine.agent_id !== (agent.engine === 'aion' ? '632f31d2' : '2d23ff1c') ||
        JSON.stringify([...(detail.capabilities.default_skill_ids ?? [])].toSorted()) !==
          JSON.stringify(agent.skills.map((name) => names[name]).toSorted())
      ) {
        throw new Error(`Managed assistant verification failed: ${agent.id}`);
      }
    }
    const ids = [...wanted];
    await api('PUT', '/api/settings/client', { 'enterprise.managedIds': ids });
    return ids;
  } catch (error) {
    const failures: string[] = [];
    for (const id of changed.toReversed()) {
      const backup = previous.get(id)!;
      try {
        await api('PUT', `/api/assistants/${id}`, restoreBody(backup.detail));
        for (const [locale, content] of Object.entries(backup.rules))
          await api('POST', '/api/skills/assistant-rule/write', { assistant_id: id, locale, content });
      } catch {
        failures.push(id);
      }
    }
    for (const id of created) {
      try {
        await api('DELETE', `/api/assistants/${id}`);
      } catch {
        failures.push(id);
      }
    }
    for (const old of before) {
      try {
        await api('PATCH', `/api/assistants/${encodeURIComponent(old.id)}/state`, {
          enabled: old.enabled,
          sort_order: old.sort_order,
        });
      } catch {
        failures.push(old.id);
      }
    }
    for (const restore of undo.toReversed()) {
      try {
        await restore();
      } catch {
        failures.push('runtime-configuration');
      }
    }
    if (failures.length)
      throw new CatalogRestorationError(
        `Catalog installation and restoration failed: ${[...new Set(failures)].join(', ')}`
      );
    throw error;
  }
}
