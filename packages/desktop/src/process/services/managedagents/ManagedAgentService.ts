/** One synchronization lifecycle per desktop process, shared by all windows and triggers. */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DeptConfig } from '@/common/deptconfig/types';
import { validateConfig } from '@/common/deptconfig/applyConfig';
import {
  parseManagedCatalog,
  type CatalogRelease,
  type ManagedConnection,
  type ManagedSyncErrorCode,
  type ManagedSyncResult,
  type ManagedSyncStatus,
} from '@/common/deptconfig/catalog';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { BackendCall } from './backend';
import { CatalogRestorationError, installCatalog } from './install';
import { installManagedSkills, sha256, writeManagedJson } from './files';
import { readCatalogEvents } from './events';
import { ConversationLeases } from './ConversationLeases';

type Credentials = { serverUrl: string; deptKey: string };
type Dependencies = {
  backend: BackendCall;
  dataDir: string;
  skillsRoot: string;
  fetch?: typeof fetch;
  install?: typeof installCatalog;
  onStatus?: (status: ManagedSyncStatus) => void;
  pollMs?: number;
  random?: () => number;
};

class AuthenticationError extends Error {}
class ConnectionError extends Error {
  constructor(
    readonly code: ManagedSyncErrorCode,
    message: string
  ) {
    super(message);
  }
}

const errorCode = (error: unknown): ManagedSyncErrorCode =>
  error instanceof AuthenticationError
    ? 'INVALID_KEY'
    : error instanceof ConnectionError
      ? error.code
      : 'UPDATE_FAILED';

function normalizeCredentials(input: Credentials): Credentials {
  let url: URL;
  try {
    url = new URL(input.serverUrl.trim());
  } catch {
    throw new ConnectionError('INVALID_CONNECTION', 'Invalid configuration connection');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !input.deptKey.trim()
  )
    throw new ConnectionError('INVALID_CONNECTION', 'Invalid configuration connection');
  return { serverUrl: url.toString().replace(/\/+$/, ''), deptKey: input.deptKey.trim() };
}

export class ManagedAgentService {
  private status: ManagedSyncStatus = {
    phase: 'idle',
    push: 'disconnected',
    assistantIds: [],
    connection: { state: 'unconfigured' },
  };
  private credentials?: Credentials;
  private task?: Promise<void>;
  private connection: Promise<unknown> = Promise.resolve();
  private safeToCreate = true;
  private leases = new ConversationLeases();
  private pending = false;
  private force = false;
  private poll?: ReturnType<typeof setTimeout>;
  private reconnect?: ReturnType<typeof setTimeout>;
  private events?: AbortController;
  private stopped = false;
  private etag?: string;
  private clientId = '';
  private readonly fetch: typeof fetch;
  private readonly cache: string;

  constructor(private readonly deps: Dependencies) {
    this.fetch = deps.fetch ?? fetch;
    this.cache = path.join(deps.dataDir, 'nexwork-managed', 'installed.json');
  }

  snapshot(): ManagedSyncStatus {
    return { ...this.status, connection: { ...this.status.connection! }, assistantIds: [...this.status.assistantIds] };
  }

  private emit(patch: Partial<ManagedSyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.deps.onStatus?.(this.snapshot());
  }

  private emitConnection(patch: Partial<ManagedConnection>): void {
    this.emit({ connection: { ...this.status.connection!, ...patch } });
  }

  private connectionFailed(error: unknown): void {
    const code = errorCode(error);
    if (code === 'INVALID_KEY') this.emitConnection({ state: 'unauthorized' });
    else if (code === 'SERVICE_UNREACHABLE') this.emitConnection({ state: 'unreachable' });
    else if (code === 'SERVICE_ERROR' || code === 'INVALID_CONFIG') this.emitConnection({ state: 'error' });
  }

  private async verifyIdentity(cfg: DeptConfig): Promise<void> {
    const identity = { serverUrl: this.credentials!.serverUrl, dept: cfg.dept, verifiedAt: Date.now() };
    this.emitConnection({ ...identity, state: 'connected' });
    await this.deps.backend('PUT', '/api/settings/client', { 'enterprise.connectionIdentity': identity });
  }

  /** Restore published skills before connecting; no credentials are stored in the catalog cache. */
  async bootstrap(): Promise<void> {
    try {
      const cached = JSON.parse(readFileSync(this.cache, 'utf8')) as {
        release: CatalogRelease;
        version: string;
        installedAt: number;
      };
      const catalog = parseManagedCatalog(cached.release);
      if (sha256(cached.release.content) !== cached.release.digest) throw new Error('Cached catalog digest mismatch');
      installManagedSkills(this.deps.skillsRoot, catalog);
      this.emit({
        version: cached.version,
        revision: cached.release.revision,
        installedAt: cached.installedAt,
        assistantIds: catalog.agents.map((a) => a.id),
        labels: Object.fromEntries(
          catalog.agents.map((a) => [
            a.id,
            {
              name_i18n: a.name_i18n,
              description_i18n: a.description_i18n,
              recommended_prompts: a.recommended_prompts ?? [],
              recommended_prompts_i18n: a.recommended_prompts_i18n ?? {},
            },
          ])
        ),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.emit({ phase: 'error', error: 'Cached catalog needs synchronization' });
    }
    const settings = await this.deps.backend<Record<string, unknown>>(
      'GET',
      '/api/settings/client?keys=enterprise.serverUrl,enterprise.deptKey,enterprise.clientId,enterprise.applyState,enterprise.connectionIdentity'
    );
    if ((settings['enterprise.applyState'] as { phase?: string } | undefined)?.phase === 'applying')
      this.safeToCreate = false;
    this.clientId =
      typeof settings['enterprise.clientId'] === 'string' ? settings['enterprise.clientId'] : randomUUID();
    await this.deps.backend('PUT', '/api/settings/client', { 'enterprise.clientId': this.clientId });
    if (typeof settings['enterprise.serverUrl'] === 'string' && typeof settings['enterprise.deptKey'] === 'string') {
      // Previously accepted credentials must keep retrying after an offline startup.
      this.credentials = normalizeCredentials({
        serverUrl: settings['enterprise.serverUrl'],
        deptKey: settings['enterprise.deptKey'],
      });
      const identity = settings['enterprise.connectionIdentity'] as Partial<ManagedConnection> | undefined;
      this.emitConnection({
        state: 'checking',
        serverUrl: this.credentials.serverUrl,
        ...(identity?.serverUrl === this.credentials.serverUrl &&
        typeof identity.dept === 'string' &&
        typeof identity.verifiedAt === 'number' &&
        Number.isFinite(identity.verifiedAt)
          ? { dept: identity.dept, verifiedAt: identity.verifiedAt }
          : {}),
      });
      await this.sync(true);
      if (this.status.phase !== 'unauthorized') this.startWatchers();
    }
  }

  /** Verify new connection details before replacing an existing working connection. */
  connect(input: Credentials): Promise<ManagedSyncResult> {
    const next = this.connection.then(() => this.replaceConnection(input));
    this.connection = next.catch(() => {});
    return next;
  }

  private async replaceConnection(input: Credentials): Promise<ManagedSyncResult> {
    try {
      const candidate = normalizeCredentials(input);
      // Authenticate and validate before retiring the old connection.
      const cfg = await this.getConfig(candidate);
      await this.task?.catch(() => {});
      if (!this.clientId) this.clientId = randomUUID();
      const identity = { serverUrl: candidate.serverUrl, dept: cfg.dept, verifiedAt: Date.now() };
      await this.deps.backend('PUT', '/api/settings/client', {
        'enterprise.serverUrl': candidate.serverUrl,
        'enterprise.deptKey': candidate.deptKey,
        'enterprise.clientId': this.clientId,
        'enterprise.connectionIdentity': identity,
      });
      this.stopWatchers();
      this.credentials = candidate;
      this.stopped = false;
      this.etag = undefined;
      this.emit({ connection: { ...identity, state: 'connected' }, error: undefined, errorCode: undefined });
      const result = await this.sync(true);
      if (this.status.phase !== 'unauthorized') this.startWatchers();
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Configuration connection failed';
      // A rejected replacement must not stop the existing valid connection.
      if (!this.credentials) {
        this.connectionFailed(error);
        this.emit({
          phase: error instanceof AuthenticationError ? 'unauthorized' : 'error',
          error: detail,
          errorCode: errorCode(error),
        });
      }
      return { success: false, status: this.snapshot(), error: detail, errorCode: errorCode(error) };
    }
  }

  /** Coalesce concurrent triggers and check again if another publication arrives during installation. */
  async sync(force = false): Promise<ManagedSyncResult> {
    if (!this.credentials || this.stopped)
      return { success: false, status: this.snapshot(), error: 'Configuration service is not connected' };
    const retryUnauthorized = this.status.phase === 'unauthorized';
    this.pending = true;
    this.force ||= force;
    if (!this.task) {
      this.task = (async () => {
        while (this.pending && !this.stopped) {
          this.pending = false;
          const forced = this.force;
          this.force = false;
          try {
            await this.synchronize(forced);
          } catch (error) {
            const unauthorized = error instanceof AuthenticationError;
            this.connectionFailed(error);
            this.emit({
              phase: unauthorized ? 'unauthorized' : 'error',
              error: error instanceof Error ? error.message : 'Catalog synchronization failed',
              errorCode: errorCode(error),
            });
            if (unauthorized) {
              this.stopWatchers();
              this.pending = false;
            }
            break;
          }
        }
      })().finally(() => {
        this.task = undefined;
      });
    }
    await this.task;
    if (retryUnauthorized && this.status.phase === 'ready' && !this.stopped) this.startWatchers();
    return {
      success: this.status.phase === 'ready',
      status: this.snapshot(),
      ...(this.status.error ? { error: this.status.error } : {}),
      ...(this.status.errorCode ? { errorCode: this.status.errorCode } : {}),
    };
  }

  /** New conversation creation waits until the active installation has settled. */
  async waitReady(): Promise<ManagedSyncResult> {
    await this.task;
    return {
      success: this.safeToCreate,
      status: this.snapshot(),
      ...(this.safeToCreate ? {} : { error: 'MANAGED_CATALOG_NOT_READY' }),
    };
  }

  async acquireConversation(): Promise<ManagedSyncResult & { lease?: string }> {
    while (this.task) await this.task;
    const result = await this.waitReady();
    if (!result.success) return result;
    // No await between checking the current task and reserving the catalog.
    if (this.task) return this.acquireConversation();
    return { ...result, lease: this.leases.acquire() };
  }

  releaseConversation(lease: string): void {
    this.leases.release(lease);
  }

  startupFailed(): void {
    this.emitConnection({ state: 'error' });
    this.emit({
      phase: 'error',
      error: 'Managed configuration could not be restored; synchronize to recover',
      errorCode: 'UPDATE_FAILED',
    });
  }

  private async remote<T>(credentials: Credentials, route: string, method = 'GET', body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetch(`${credentials.serverUrl}${route}`, {
        method,
        headers: { 'X-Cynapse-Key': credentials.deptKey, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ConnectionError('SERVICE_UNREACHABLE', 'Configuration service is unreachable');
    }
    if (response.status === 401) throw new AuthenticationError('Configuration credential is invalid or revoked');
    if (!response.ok)
      throw new ConnectionError('SERVICE_ERROR', `Configuration service ${route} failed (${response.status})`);
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new ConnectionError('SERVICE_UNREACHABLE', 'Configuration response was interrupted');
    }
    try {
      if (Buffer.byteLength(text) > 3 * 1024 * 1024) throw new Error('Configuration response is too large');
      return JSON.parse(text) as T;
    } catch {
      throw new ConnectionError('INVALID_CONFIG', 'Configuration response is invalid');
    }
  }

  private async getConfig(credentials: Credentials): Promise<DeptConfig> {
    const cfg = await this.remote<DeptConfig>(credentials, '/config');
    try {
      if (typeof cfg?.dept !== 'string' || !cfg.dept.trim()) throw new Error('Missing authenticated department');
      if (!cfg.agent_catalog) throw new Error('The configuration service has not enabled managed agent publication');
      const errors = validateConfig(cfg);
      if (errors.length) throw new Error('The published configuration is invalid');
      parseManagedCatalog(cfg.agent_catalog);
      if (sha256(cfg.agent_catalog.content) !== cfg.agent_catalog.digest) throw new Error('Catalog digest mismatch');
    } catch {
      throw new ConnectionError('INVALID_CONFIG', 'The published configuration is invalid');
    }
    return cfg;
  }

  private async synchronize(force: boolean): Promise<void> {
    const credentials = this.credentials!;
    this.emitConnection({ state: 'checking' });
    this.emit({ checkedAt: Date.now() });
    const head = await this.remote<{ version: string; etag: string }>(credentials, '/config/version');
    if (typeof head?.version !== 'string' || typeof head.etag !== 'string')
      throw new ConnectionError('INVALID_CONFIG', 'Invalid configuration version');
    if (!force && this.etag === head.etag && this.status.phase === 'ready' && this.status.connection?.dept) {
      this.emitConnection({ state: 'connected', verifiedAt: Date.now() });
      return;
    }
    const cfg = await this.getConfig(credentials);
    await this.verifyIdentity(cfg);
    const catalog = parseManagedCatalog(cfg.agent_catalog!);
    await this.leases.wait();
    this.emit({ phase: 'syncing', error: undefined, errorCode: undefined });
    await this.deps.backend('PUT', '/api/settings/client', {
      'enterprise.applyState': { phase: 'applying', version: cfg.version, at: Date.now() },
    });
    let ids: string[];
    try {
      ids = await (this.deps.install ?? installCatalog)(cfg, catalog, {
        backend: this.deps.backend,
        skillsRoot: this.deps.skillsRoot,
        ...credentials,
        clientId: this.clientId,
      });
      this.safeToCreate = true;
    } catch (error) {
      if (error instanceof CatalogRestorationError) this.safeToCreate = false;
      else if (this.safeToCreate) {
        await this.deps.backend('PUT', '/api/settings/client', {
          'enterprise.applyState': {
            phase: 'applied',
            version: this.status.version ?? 'bootstrap',
            at: this.status.installedAt ?? Date.now(),
          },
        });
      }
      throw error;
    }
    const installedAt = Date.now();
    writeManagedJson(this.cache, { release: cfg.agent_catalog, version: cfg.version, installedAt });
    await this.deps.backend('PUT', '/api/settings/client', {
      'enterprise.applyState': { phase: 'applied', version: cfg.version, at: installedAt },
      'enterprise.capabilities': cfg.capabilities ?? {},
      'enterprise.agentNames': cfg.agent_names ?? {},
    });
    this.etag = cfg.version === head.version ? head.etag : undefined;
    this.emit({
      phase: 'ready',
      version: cfg.version,
      revision: cfg.agent_catalog!.revision,
      installedAt,
      assistantIds: ids,
      labels: Object.fromEntries(
        catalog.agents.map((a) => [
          a.id,
          {
            name_i18n: a.name_i18n,
            description_i18n: a.description_i18n,
            recommended_prompts: a.recommended_prompts ?? [],
            recommended_prompts_i18n: a.recommended_prompts_i18n ?? {},
          },
        ])
      ),
      error: undefined,
      errorCode: undefined,
    });
    try {
      const actual = await this.deps.backend<Assistant[]>('GET', '/api/assistants');
      const engines = await this.deps.backend<Array<{ id: string; enabled: boolean }>>('GET', '/api/agents/management');
      const report = await this.remote<{ ok: boolean; drift?: string[] }>(credentials, '/report', 'POST', {
        client_id: this.clientId,
        applied_version: cfg.version,
        agents_enabled: engines.filter((a) => a.enabled).map((a) => a.id),
        assistants_enabled: actual.filter((a) => a.enabled).map((a) => a.id),
        installed_assistants: ids,
        catalog_revision: cfg.agent_catalog!.revision,
        failures: [],
      });
      if (!report.ok)
        this.emit({
          error: 'Catalog installed; server comparison reported configuration drift',
          errorCode: 'CONFIGURATION_DRIFT',
        });
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      this.connectionFailed(error);
      this.emit({ error: 'Catalog installed; reporting its status failed', errorCode: 'REPORT_FAILED' });
    }
  }

  private startWatchers(): void {
    if (this.stopped || !this.credentials) return;
    this.schedulePoll();
    this.openEvents(1000);
  }

  private schedulePoll(): void {
    if (this.poll) clearTimeout(this.poll);
    const delay = (this.deps.pollMs ?? 300_000) * (0.9 + (this.deps.random ?? Math.random)() * 0.2);
    this.poll = setTimeout(() => {
      void this.sync().finally(() => {
        if (!this.stopped && this.status.phase !== 'unauthorized') this.schedulePoll();
      });
    }, delay);
    this.poll.unref?.();
  }

  private openEvents(backoff: number): void {
    if (this.stopped || !this.credentials || this.status.phase === 'unauthorized') return;
    const credentials = this.credentials;
    const controller = new AbortController();
    this.events = controller;
    this.emit({ push: 'connecting' });
    void (async () => {
      let wasConnected = false;
      const connectTimeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await this.fetch(`${credentials.serverUrl}/registry/events`, {
          headers: { 'X-Cynapse-Key': credentials.deptKey, Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        clearTimeout(connectTimeout);
        if (this.events !== controller) return;
        if (response.status === 401) throw new AuthenticationError('Configuration credential is invalid or revoked');
        if (!response.ok) throw new Error(`Catalog events failed (${response.status})`);
        this.emit({ push: 'connected' });
        wasConnected = true;
        void this.sync();
        await readCatalogEvents(response, controller.signal, (event) => {
          if (event === 'auth_revoked') throw new AuthenticationError('Configuration credential was revoked');
          if (event === 'catalog_changed') void this.sync();
        });
      } catch (error) {
        if (error instanceof AuthenticationError && this.events === controller) {
          this.emitConnection({ state: 'unauthorized' });
          this.emit({ phase: 'unauthorized', error: error.message, errorCode: 'INVALID_KEY' });
          this.stopWatchers();
        }
      } finally {
        clearTimeout(connectTimeout);
        if (this.events === controller && !this.stopped && this.status.phase !== 'unauthorized') {
          this.emit({ push: 'disconnected' });
          // Check the configuration endpoint before declaring the whole service unreachable.
          if (wasConnected) void this.sync();
          this.reconnect = setTimeout(
            () => this.openEvents(Math.min(backoff * 2, 30_000)),
            backoff * (0.8 + (this.deps.random ?? Math.random)() * 0.4)
          );
          this.reconnect.unref?.();
        }
      }
    })();
  }

  private stopWatchers(): void {
    if (this.poll) clearTimeout(this.poll);
    if (this.reconnect) clearTimeout(this.reconnect);
    this.events?.abort();
    this.events = undefined;
    this.emit({ push: 'disconnected' });
  }

  resume(): void {
    if (!this.credentials || this.stopped || this.status.phase === 'unauthorized') return;
    this.stopWatchers();
    void this.sync();
    this.startWatchers();
  }

  stop(): void {
    this.stopped = true;
    this.pending = false;
    this.stopWatchers();
  }
}
