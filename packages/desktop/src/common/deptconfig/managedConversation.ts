/** A desktop-provided gate keeps new conversations outside catalog installation windows. */
import type { ManagedLabels } from '@/common/deptconfig/catalog';
import { MANAGED_CORE_IDS } from '@/common/deptconfig/catalog';
import type { AssistantDetail } from '@/common/types/agent/assistantTypes';
import type { IMcpServer } from '@/common/config/storage';
type Release = () => Promise<void>;
let waitForCatalog: (() => Promise<Release | void>) | undefined;
let visibleIds: Set<string> | undefined;
let labels: ManagedLabels = {};

export function setManagedCatalogIds(ids: readonly string[], localized: ManagedLabels = {}): void {
  visibleIds = new Set(['default-assistant', ...ids]);
  labels = localized;
}
export function isManagedAssistant(id: string): boolean {
  return MANAGED_CORE_IDS.some((coreId) => coreId === id) || (visibleIds?.has(id) ?? false);
}

/** Employee edits cannot replace the engine of a published assistant. */
export function assertManagedEngineEditAllowed(method: string, route: string, body: unknown): void {
  if (!['PUT', 'PATCH'].includes(method) || !body || typeof body !== 'object') return;
  const match = /^\/api\/assistants\/([^/?]+)(?:\?.*)?$/.exec(route);
  if (match && isManagedAssistant(decodeURIComponent(match[1])) && ('agent_id' in body || 'engine' in body))
    throw new Error('MANAGED_ENGINE_READ_ONLY');
}
export function filterManagedAssistants<T extends { id: string }>(items: T[]): T[] {
  return visibleIds
    ? items.filter((item) => visibleIds!.has(item.id)).map((item) => ({ ...item, ...labels[item.id] }))
    : items;
}

/** The pinned backend intentionally omits localization for user-owned records. */
export function localizeManagedAssistant(detail: AssistantDetail): AssistantDetail {
  return labels[detail.id] ? { ...detail, profile: { ...detail.profile, ...labels[detail.id] } } : detail;
}

export function setManagedConversationGate(wait: () => Promise<Release | void>): void {
  waitForCatalog = wait;
}

export async function waitForManagedCatalog(method: string, route: string): Promise<Release | void> {
  if (method === 'POST' && (route === '/api/conversations' || route.endsWith('/create-with-conversation')))
    return await waitForCatalog?.();
}

/** Resolve managed defaults at creation time, after waiting for any active publication. */
export async function prepareManagedConversation(
  method: string,
  route: string,
  body: unknown,
  read: <T>(path: string) => Promise<T>
): Promise<unknown> {
  if (method !== 'POST' || route !== '/api/conversations' || !body || typeof body !== 'object') return body;
  const input = body as {
    assistant?: { id?: string; conversation_overrides?: Record<string, unknown> };
    extra?: Record<string, unknown>;
  };
  const id = input.assistant?.id;
  if (!id || !isManagedAssistant(id)) return body;
  const detail = await read<AssistantDetail>(`/api/assistants/${encodeURIComponent(id)}`);
  const servers = await read<IMcpServer[]>('/api/mcp/servers');
  const wanted = new Set(detail.defaults.mcps.value ?? []);
  const selected = servers.filter((server) => server.enabled && wanted.has(server.id));
  if (selected.length !== wanted.size) throw new Error('MANAGED_MCP_UNAVAILABLE');
  return {
    ...input,
    assistant: {
      ...input.assistant,
      conversation_overrides: {
        ...input.assistant?.conversation_overrides,
        skill_ids: detail.capabilities.default_skill_ids ?? [],
        disabled_builtin_skill_ids: detail.capabilities.default_disabled_builtin_skill_ids ?? [],
        mcp_ids: [...wanted],
        ...(detail.defaults.model.mode === 'fixed' ? { model: detail.defaults.model.value } : {}),
      },
    },
    extra: {
      ...input.extra,
      selected_mcp_server_ids: [],
      selected_session_mcp_servers: selected.map(({ id, name, transport }) => ({ id, name, transport })),
    },
  };
}
