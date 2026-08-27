/**
 * [ENTERPRISE PATCH] spec 006 — live integration.
 *
 * Runs against a running NexWork instance when one is reachable, and skips
 * otherwise so CI without a backend stays green. The unit tests cover the
 * logic; this covers the assumption that the backend accepts what we send.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  classifyRuntime,
  buildEnvOverride,
  parseGatewayModels,
  planProvisioning,
} from '@/common/gateway/provisionGateway';
import { GATEWAY_ENV_BASE_URL, type EnvEntry } from '@/common/gateway/types';

const BASE = process.env.NEXWORK_BASE_URL ?? 'http://127.0.0.1:25809';
const GW = 'http://litellm.internal:4000';
/** A real, reachable gateway. Set alongside NEXWORK_LIVE to exercise the probe. */
const LIVE_GW = process.env.NEXWORK_GATEWAY_URL ?? '';
const LIVE_KEY = process.env.NEXWORK_GATEWAY_KEY ?? '';
const GATEWAY_PROVIDER_NAME = 'NexWork Gateway';

let reachable = false;
let cliAgents: { id: string; name: string; agent_type: string }[] = [];

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  return (await res.json()) as { success: boolean; data?: unknown };
};

beforeAll(async () => {
  try {
    const r = await api('/api/agents/management');
    reachable = r.success === true;
    const items = (r.data ?? []) as { id: string; name: string; agent_type: string }[];
    cliAgents = items.filter((a) => a.agent_type === 'acp');
  } catch {
    reachable = false;
  }
});

describe.runIf(process.env.NEXWORK_LIVE === '1')('gateway provisioning against a live instance', () => {
  it('the backend exposes CLI agents to provision', () => {
    expect(reachable).toBe(true);
    expect(cliAgents.length).toBeGreaterThan(0);
  });

  it('accepts the env override shape buildEnvOverride produces', async () => {
    const target = cliAgents.find((a) => a.name.includes('Claude')) ?? cliAgents[0];
    const env = buildEnvOverride([], { baseUrl: GW, apiKey: 'sk-live-test' });

    const put = await api(`/api/agents/${target.id}/overrides`, {
      method: 'PUT',
      body: JSON.stringify({ env_override: env }),
    });
    expect(put.success).toBe(true);

    const got = await api(`/api/agents/${target.id}/overrides`);
    const stored = ((got.data as { env_override?: EnvEntry[] })?.env_override ?? []) as EnvEntry[];
    expect(stored).toContainEqual({ name: GATEWAY_ENV_BASE_URL, value: GW });
    // The round trip is what matters: what we compute must be what the backend keeps.
    expect(classifyRuntime(stored, GW).state).toBe('gateway');
  });

  it('reports unprovisioned runtimes as unset rather than omitting them', async () => {
    const withEnv = await Promise.all(
      cliAgents.map(async (a) => {
        const o = await api(`/api/agents/${a.id}/overrides`);
        return {
          runtimeId: a.id,
          runtimeName: a.name,
          env: ((o.data as { env_override?: EnvEntry[] })?.env_override ?? []) as EnvEntry[],
        };
      })
    );
    const { statuses } = planProvisioning(withEnv, { baseUrl: GW, apiKey: '' });
    // Every runtime must appear — a missing row is the silent hole spec 006 closes.
    expect(statuses).toHaveLength(cliAgents.length);
    expect(statuses.every((s) => ['gateway', 'unset', 'overridden'].includes(s.state))).toBe(true);
  });
});

/**
 * The aionrs half of provisioning, which the unit tests cannot reach: it writes
 * a provider row rather than an env override, and every defect found here was
 * invisible to a passing unit suite.
 */
describe.runIf(process.env.NEXWORK_LIVE === '1' && LIVE_GW !== '')('aionrs provider row against a live gateway', () => {
  const listProviders = async () =>
    ((await api('/api/providers')).data ?? []) as { id: string; name: string; models: string[]; base_url: string }[];

  beforeAll(async () => {
    for (const p of await listProviders()) {
      if (p.name === GATEWAY_PROVIDER_NAME) await api(`/api/providers/${p.id}`, { method: 'DELETE' });
    }
  });

  it('the probe returns a usable model list, and the wildcard is not in it', async () => {
    const res = await api('/api/providers/fetch-models', {
      method: 'POST',
      body: JSON.stringify({ platform: 'custom', base_url: LIVE_GW, api_key: LIVE_KEY }),
    });
    expect(res.success).toBe(true);
    const models = parseGatewayModels((res.data as { models?: unknown })?.models);
    // Empty is the FR-5 failure: `getAvailableModels` iterates provider.models,
    // so an empty row means aionrs can select nothing and send nothing.
    expect(models.length).toBeGreaterThan(0);
    expect(models).not.toContain('*');
  });

  it('a wrong key is reported as a failure rather than silently accepted', async () => {
    const res = await api('/api/providers/fetch-models', {
      method: 'POST',
      body: JSON.stringify({ platform: 'custom', base_url: LIVE_GW, api_key: 'sk-definitely-wrong' }),
    });
    expect(res.success).toBe(false);
  });

  it('an unreachable gateway is reported as a failure', async () => {
    const res = await api('/api/providers/fetch-models', {
      method: 'POST',
      body: JSON.stringify({ platform: 'custom', base_url: 'http://127.0.0.1:59999/v1', api_key: LIVE_KEY }),
    });
    expect(res.success).toBe(false);
  });

  it('saving twice updates one row instead of appending a second', async () => {
    const probe = await api('/api/providers/fetch-models', {
      method: 'POST',
      body: JSON.stringify({ platform: 'custom', base_url: LIVE_GW, api_key: LIVE_KEY }),
    });
    const models = parseGatewayModels((probe.data as { models?: unknown })?.models);

    const created = await api('/api/providers', {
      method: 'POST',
      body: JSON.stringify({
        name: GATEWAY_PROVIDER_NAME,
        platform: 'custom',
        base_url: LIVE_GW,
        api_key: LIVE_KEY,
        models,
      }),
    });
    expect(created.success).toBe(true);
    const id = (created.data as { id: string }).id;

    // The second save is an update, keyed by the id the status read hands back.
    const updated = await api(`/api/providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ platform: 'custom', name: GATEWAY_PROVIDER_NAME, base_url: LIVE_GW, models }),
    });
    expect(updated.success).toBe(true);

    const rows = (await listProviders()).filter((p) => p.name === GATEWAY_PROVIDER_NAME);
    expect(rows).toHaveLength(1);
    expect(rows[0].models.length).toBeGreaterThan(0);
  });
});
