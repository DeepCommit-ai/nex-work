/** Electron lifecycle and IPC binding around the independently testable synchronizer. */
import { app, powerMonitor } from 'electron';
import { managedAgents } from '@/common/adapter/ipcBridge';
import type { ManagedSyncResult } from '@/common/deptconfig/catalog';
import { ManagedAgentService } from './ManagedAgentService';
import { createBackendCall } from './backend';

let service: ManagedAgentService | undefined;
let bootstrap: Promise<void> | undefined;
let hooksRegistered = false;

/** Initialize after the backend owns its data directory and has completed migrations. */
export function startManagedAgents(port: number, dataDir: string, skillsRoot: string): void {
  service?.stop();
  service = new ManagedAgentService({
    backend: createBackendCall(port),
    dataDir,
    skillsRoot,
    onStatus: (status) => managedAgents.changed.emit(status),
  });
  const current = service;
  bootstrap = current.bootstrap().catch(() => current.startupFailed());
  if (!hooksRegistered) {
    powerMonitor.on('resume', () => service?.resume());
    app.on('before-quit', () => service?.stop());
    hooksRegistered = true;
  }
}

/** Every provider returns an envelope, including startup and unexpected failure paths. */
export function initManagedAgentsBridge(): void {
  const safely = async (
    run: (current: ManagedAgentService) => Promise<ManagedSyncResult>
  ): Promise<ManagedSyncResult> => {
    if (!service)
      return {
        success: false,
        error: 'Managed service is not ready',
        status: { phase: 'idle', push: 'disconnected', assistantIds: [] },
      };
    try {
      return await run(service);
    } catch (error) {
      return {
        success: false,
        status: service.snapshot(),
        error: error instanceof Error ? error.message : 'Managed operation failed',
      };
    }
  };
  managedAgents.connect.provider((input) =>
    safely(async (current) => {
      await bootstrap;
      return current.connect(input);
    })
  );
  managedAgents.sync.provider(() =>
    safely(async (current) => {
      await bootstrap;
      return current.sync(true);
    })
  );
  managedAgents.ready.provider(() =>
    safely(async (current) => {
      await bootstrap;
      return current.waitReady();
    })
  );
  managedAgents.acquire.provider(async () => {
    await bootstrap;
    return (
      service?.acquireConversation() ?? {
        success: false,
        status: { phase: 'idle', push: 'disconnected', assistantIds: [] },
        error: 'Managed service is not ready',
      }
    );
  });
  managedAgents.release.provider(({ lease }) => {
    service?.releaseConversation(lease);
    return Promise.resolve();
  });
  managedAgents.status.provider(() =>
    Promise.resolve(service?.snapshot() ?? { phase: 'idle', push: 'disconnected', assistantIds: [] })
  );
}
