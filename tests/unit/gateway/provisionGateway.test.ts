import { describe, expect, it } from 'vitest';
import {
  buildEnvOverride,
  classifyRuntime,
  isFullyProvisioned,
  isIsolated,
  parseGatewayModels,
  planProvisioning,
} from '@/common/gateway/provisionGateway';
import {
  GATEWAY_ENV_CUSTOM_HEADERS,
  GATEWAY_ENV_AUTH_TOKEN,
  GATEWAY_ENV_BASE_URL,
  GATEWAY_ENV_CONFIG_DIR,
  type EnvEntry,
} from '@/common/gateway/types';

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

describe('parseGatewayModels', () => {
  it('accepts the bare-id shape LiteLLM returns', () => {
    expect(parseGatewayModels(['glm-4.7', 'glm-5'])).toEqual(['glm-4.7', 'glm-5']);
  });

  it('accepts the { id, name } shape the backend may return instead', () => {
    expect(
      parseGatewayModels([
        { id: 'glm-4.7', name: 'GLM 4.7' },
        { id: 'glm-5', name: 'GLM 5' },
      ])
    ).toEqual(['glm-4.7', 'glm-5']);
  });

  it('drops the wildcard row', () => {
    // Verified against a live LiteLLM: /v1/models lists `*` beside real aliases.
    // Selecting it would send `*` as the model name and the request would fail.
    expect(parseGatewayModels(['glm-4.7', '*'])).toEqual(['glm-4.7']);
  });

  it('drops blanks and de-duplicates', () => {
    expect(parseGatewayModels(['glm-5', '  ', 'glm-5', { id: '' }])).toEqual(['glm-5']);
  });

  it('returns empty for a non-array payload rather than throwing', () => {
    // The caller treats empty as a probe failure; a throw here would take the
    // whole save down instead, which FR-7 forbids.
    expect(parseGatewayModels(undefined)).toEqual([]);
    expect(parseGatewayModels({ models: ['glm-5'] })).toEqual([]);
  });
});

describe('CLAUDE_CONFIG_DIR', () => {
  const DIR = '/opt/nexwork/claude';

  it('is written by the same call that writes the gateway vars', () => {
    // `env_override` is one store. Two independent writers would each see the
    // other's variable as an unmanaged entry and fight over it — spec 002's
    // design doc calls this out as the conflict to avoid.
    const out = buildEnvOverride([], { baseUrl: GW, apiKey: 'sk-x', configDir: DIR });
    expect(out).toContainEqual({ name: GATEWAY_ENV_CONFIG_DIR, value: DIR });
    expect(out).toContainEqual({ name: GATEWAY_ENV_BASE_URL, value: GW });
    expect(out).toContainEqual({ name: GATEWAY_ENV_AUTH_TOKEN, value: 'sk-x' });
  });

  it('keeps an existing directory when the field is left blank', () => {
    // Same rule as the key: a save that did not re-enter the value must not
    // clear an isolation that is already in place.
    const existing: EnvEntry[] = [{ name: GATEWAY_ENV_CONFIG_DIR, value: DIR }];
    const out = buildEnvOverride(existing, { baseUrl: GW, apiKey: '' });
    expect(out).toContainEqual({ name: GATEWAY_ENV_CONFIG_DIR, value: DIR });
  });

  it('leaves unrelated entries alone', () => {
    const existing: EnvEntry[] = [{ name: 'HTTPS_PROXY', value: 'http://p:8080' }];
    const out = buildEnvOverride(existing, { baseUrl: GW, apiKey: 'k', configDir: DIR });
    expect(out).toContainEqual({ name: 'HTTPS_PROXY', value: 'http://p:8080' });
  });

  it('does not invent a directory when none is configured anywhere', () => {
    const names = buildEnvOverride([], { baseUrl: GW, apiKey: 'k' }).map((e) => e.name);
    expect(names).not.toContain(GATEWAY_ENV_CONFIG_DIR);
  });

  it('is reported beside the gateway state, not folded into it', () => {
    // Reaching the gateway and being isolated are different properties. An
    // un-isolated runtime still reaches the gateway and still bills correctly —
    // what it loses is that its transcripts land where the collector never looks.
    const { statuses } = planProvisioning(
      [
        { runtimeId: 'a', runtimeName: 'A', env: [{ name: GATEWAY_ENV_BASE_URL, value: GW }] },
        {
          runtimeId: 'b',
          runtimeName: 'B',
          env: [
            { name: GATEWAY_ENV_BASE_URL, value: GW },
            { name: GATEWAY_ENV_CONFIG_DIR, value: DIR },
          ],
        },
      ],
      cfg()
    );
    expect(statuses[0]).toMatchObject({ state: 'gateway', isolated: false });
    expect(statuses[1]).toMatchObject({ state: 'gateway', isolated: true });
  });

  it('treats a blank value as not isolated', () => {
    expect(isIsolated([{ name: GATEWAY_ENV_CONFIG_DIR, value: '   ' }])).toBe(false);
  });
});

describe('buildEnvOverride — provenance header env (ANTHROPIC_CUSTOM_HEADERS)', () => {
  const dept = {
    baseUrl: 'http://gw:54000',
    apiKey: 'sk-1',
    customHeadersValue: 'x-litellm-spend-logs-metadata: {"dept":"finance"}',
  };

  it('writes the provenance header env as a managed variable', () => {
    expect(buildEnvOverride([], dept)).toContainEqual({
      name: GATEWAY_ENV_CUSTOM_HEADERS,
      value: 'x-litellm-spend-logs-metadata: {"dept":"finance"}',
    });
  });

  it('a manual save without a value keeps what dept-config wrote', () => {
    // 手动网关页从不计算 provenance；一次手动保存不得悄悄抹掉埋点头——
    // 抹掉之后一切照常工作，只是从那一刻起的记录再也答不了"哪个部门"。
    const existing = [{ name: GATEWAY_ENV_CUSTOM_HEADERS, value: 'x-litellm-spend-logs-metadata: {"dept":"hr"}' }];
    expect(buildEnvOverride(existing, { baseUrl: 'http://gw:54000', apiKey: '' })).toContainEqual(existing[0]);
  });

  it('a new dept value replaces the old one instead of duplicating', () => {
    const existing = [{ name: GATEWAY_ENV_CUSTOM_HEADERS, value: 'x-litellm-spend-logs-metadata: {"dept":"hr"}' }];
    const out = buildEnvOverride(existing, dept);
    expect(out.filter((e) => e.name === GATEWAY_ENV_CUSTOM_HEADERS)).toEqual([
      { name: GATEWAY_ENV_CUSTOM_HEADERS, value: dept.customHeadersValue },
    ]);
  });
});
