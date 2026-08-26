/**
 * [ENTERPRISE PATCH] spec 006 — live integration.
 *
 * Runs against a running NexWork instance when one is reachable, and skips
 * otherwise so CI without a backend stays green. The unit tests cover the
 * logic; this covers the assumption that the backend accepts what we send.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { classifyRuntime, buildEnvOverride, planProvisioning } from '@/common/gateway/provisionGateway';
import { GATEWAY_ENV_BASE_URL, type EnvEntry } from '@/common/gateway/types';

const BASE = process.env.NEXWORK_BASE_URL ?? 'http://127.0.0.1:25809';
const GW = 'http://litellm.internal:4000';

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
