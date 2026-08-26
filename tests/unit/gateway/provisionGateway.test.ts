import { describe, expect, it } from 'vitest';
import {
  buildEnvOverride,
  classifyRuntime,
  isFullyProvisioned,
  planProvisioning,
} from '@/common/gateway/provisionGateway';
import { GATEWAY_ENV_AUTH_TOKEN, GATEWAY_ENV_BASE_URL, type EnvEntry } from '@/common/gateway/types';

const GW = 'http://litellm.internal:4000';
const cfg = (apiKey = 'sk-test') => ({ baseUrl: GW, apiKey });

describe('classifyRuntime', () => {
  it('reports unset when no base url is present', () => {
    expect(classifyRuntime([], GW)).toEqual({ state: 'unset' });
  });

  it('treats an empty base url as unset, not as agreement', () => {
    // A blank value silently passing as "configured" is exactly the hole this spec closes.
    expect(classifyRuntime([{ name: GATEWAY_ENV_BASE_URL, value: '   ' }], GW)).toEqual({ state: 'unset' });
  });

  it('reports gateway when the base url matches', () => {
    expect(classifyRuntime([{ name: GATEWAY_ENV_BASE_URL, value: GW }], GW)).toEqual({ state: 'gateway' });
  });

  it('ignores trailing slashes and surrounding space when comparing', () => {
    expect(classifyRuntime([{ name: GATEWAY_ENV_BASE_URL, value: ` ${GW}/ ` }], GW).state).toBe('gateway');
  });

  it('reports overridden and surfaces the conflicting value', () => {
    const other = 'https://api.anthropic.com';
    expect(classifyRuntime([{ name: GATEWAY_ENV_BASE_URL, value: other }], GW)).toEqual({
      state: 'overridden',
      currentValue: other,
    });
  });
});

describe('buildEnvOverride', () => {
  it('sets both gateway variables', () => {
    const env = buildEnvOverride([], cfg());
    expect(env).toContainEqual({ name: GATEWAY_ENV_BASE_URL, value: GW });
    expect(env).toContainEqual({ name: GATEWAY_ENV_AUTH_TOKEN, value: 'sk-test' });
  });

  it('preserves unrelated entries', () => {
    const existing: EnvEntry[] = [{ name: 'HTTP_PROXY', value: 'http://squid:3128' }];
    expect(buildEnvOverride(existing, cfg())).toContainEqual(existing[0]);
  });

  it('keeps the existing token when the key field was left blank', () => {
    // FR-6: the key is write-only, so a save without re-entering it must not wipe it.
    const existing: EnvEntry[] = [{ name: GATEWAY_ENV_AUTH_TOKEN, value: 'sk-old' }];
    expect(buildEnvOverride(existing, cfg(''))).toContainEqual({ name: GATEWAY_ENV_AUTH_TOKEN, value: 'sk-old' });
  });

  it('replaces the token when a new one is supplied', () => {
    const existing: EnvEntry[] = [{ name: GATEWAY_ENV_AUTH_TOKEN, value: 'sk-old' }];
    const env = buildEnvOverride(existing, cfg('sk-new'));
    expect(env).toContainEqual({ name: GATEWAY_ENV_AUTH_TOKEN, value: 'sk-new' });
    expect(env.filter((e) => e.name === GATEWAY_ENV_AUTH_TOKEN)).toHaveLength(1);
  });

  it('omits the token entirely when none is known', () => {
    expect(buildEnvOverride([], cfg('')).some((e) => e.name === GATEWAY_ENV_AUTH_TOKEN)).toBe(false);
  });

  it('normalises the stored base url', () => {
    const env = buildEnvOverride([], { baseUrl: `${GW}///`, apiKey: 'k' });
    expect(env).toContainEqual({ name: GATEWAY_ENV_BASE_URL, value: GW });
  });
});

describe('planProvisioning', () => {
  const runtimes = [
    { runtimeId: 'claude', runtimeName: 'Claude Code', env: [] as EnvEntry[] },
    { runtimeId: 'codex', runtimeName: 'Codex', env: [{ name: GATEWAY_ENV_BASE_URL, value: GW }] },
    { runtimeId: 'other', runtimeName: 'Other', env: [{ name: GATEWAY_ENV_BASE_URL, value: 'https://elsewhere' }] },
  ];

  it('writes to unset and already-pointed runtimes', () => {
    const { toWrite } = planProvisioning(runtimes, cfg());
    expect(toWrite.map((w) => w.runtimeId)).toEqual(['claude', 'codex']);
  });

  it('does not silently overwrite a manual override', () => {
    // FR-4 — the whole point is that the user sees the conflict first.
    const { toWrite, statuses } = planProvisioning(runtimes, cfg());
    expect(toWrite.some((w) => w.runtimeId === 'other')).toBe(false);
    expect(statuses.find((s) => s.runtimeId === 'other')).toMatchObject({
      state: 'overridden',
      currentValue: 'https://elsewhere',
    });
  });

  it('writes to a conflicting runtime once the user resolves it', () => {
    const { toWrite } = planProvisioning(runtimes, cfg(), ['other']);
    expect(toWrite.map((w) => w.runtimeId)).toContain('other');
  });

  it('reports a status for every runtime, including ones it will not write', () => {
    expect(planProvisioning(runtimes, cfg()).statuses).toHaveLength(runtimes.length);
  });
});

describe('isFullyProvisioned', () => {
  it('is false when any runtime is unset', () => {
    expect(
      isFullyProvisioned([
        { runtimeId: 'a', runtimeName: 'A', state: 'gateway' },
        { runtimeId: 'b', runtimeName: 'B', state: 'unset' },
      ])
    ).toBe(false);
  });

  it('is false when nothing is known, rather than vacuously true', () => {
    // An empty list must not read as "everything is fine".
    expect(isFullyProvisioned([])).toBe(false);
  });

  it('is true only when every runtime reaches the gateway', () => {
    expect(isFullyProvisioned([{ runtimeId: 'a', runtimeName: 'A', state: 'gateway' }])).toBe(true);
  });
});
