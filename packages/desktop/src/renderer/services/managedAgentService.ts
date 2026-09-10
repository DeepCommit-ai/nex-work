/** Renderer subscriptions and compatibility with the enterprise connection form. */
import { mutate } from 'swr';
import { managedAgents } from '@/common/adapter/ipcBridge';
import { httpRequest } from '@/common/adapter/httpBridge';
import { setManagedCatalogIds, setManagedConversationGate } from '@/common/deptconfig/managedConversation';
import { normalizePolicy, setPolicy } from '@/common/capabilities/policy';
import type { ManagedSyncResult, ManagedSyncStatus } from '@/common/deptconfig/catalog';
import { buildReport } from '@/common/deptconfig/applyConfig';
import type { ApplyOutcome } from './deptConfigService';

let bound = false;
let lastRevision: number | undefined;

async function refreshPolicy(status: ManagedSyncStatus): Promise<void> {
  const settings = await httpRequest<Record<string, unknown>>(
    'GET',
    '/api/settings/client?keys=enterprise.capabilities,enterprise.agentNames'
  );
  setPolicy(
    normalizePolicy(
      {
        version: status.version ?? '',
        capabilities: (settings['enterprise.capabilities'] as Record<string, boolean>) ?? {},
        agentNames: (settings['enterprise.agentNames'] as Record<string, string>) ?? {},
      },
      'remote'
    )
  );
}

/** Bind before conversation creation; native IPC remains the only main-process entry point. */
export function bindManagedAgentSync(): void {
  if (bound) return;
  bound = true;
  setManagedConversationGate(async () => {
    const result = await managedAgents.acquire.invoke();
    if (!result.success || !result.lease) throw new Error(result.error ?? 'MANAGED_CATALOG_NOT_READY');
    const lease = result.lease;
    return async () => {
      await managedAgents.release.invoke({ lease }).catch(() => {});
    };
  });
  const receive = (status: ManagedSyncStatus): void => {
    setManagedCatalogIds(status.assistantIds, status.labels);
    if (status.phase === 'ready') {
      void refreshPolicy(status).catch(() => {});
      if (lastRevision !== status.revision) {
        lastRevision = status.revision;
        void mutate('assistants.list');
        void mutate('acp.agents');
      }
    }
  };
  managedAgents.changed.on(receive);
  void managedAgents.status.invoke().then(receive);
}

export function managedApplyOutcome(result: ManagedSyncResult): ApplyOutcome {
  if (!result.success)
    return { status: 'failed', detail: result.error ?? 'Managed synchronization failed', errorCode: result.errorCode };
  return {
    status: 'applied',
    report: buildReport(
      result.status.version ?? '',
      [],
      {
        agents: [],
        assistants: result.status.assistantIds.map((id) => ({ id, enabled: true })),
      },
      []
    ),
    drift: [],
  };
}

export async function connectManagedAgents(serverUrl: string, deptKey: string): Promise<ApplyOutcome> {
  bindManagedAgentSync();
  const result = await managedAgents.connect.invoke({ serverUrl, deptKey });
  if (result.success) {
    setManagedCatalogIds(result.status.assistantIds, result.status.labels);
    await refreshPolicy(result.status);
    await mutate('assistants.list');
  }
  return managedApplyOutcome(result);
}
