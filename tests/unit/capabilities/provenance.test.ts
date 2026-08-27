import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CAPABILITIES, setPolicy, STATIC_POLICY } from '@/common/capabilities/policy';
import { buildProvenance, provenanceHeaders, SPEND_LOGS_METADATA_HEADER } from '@/common/capabilities/provenance';

afterEach(() => setPolicy(STATIC_POLICY));

describe('provenance', () => {
  it('is sent even under the static provider', () => {
    // spec 002: "Provenance is sent before there is anything but `static` to
    // report" —— 它必须能在事后区分两者，而不是只在有远端时才有意义。
    setPolicy(STATIC_POLICY);
    expect(buildProvenance()).toMatchObject({ policy_source: 'static', policy_version: 'static-1' });
  });

  it('never reports a failed fetch as a server decision', () => {
    // 记录声称服务端做了决定、而服务端一个字都没说，比没有记录更糟——
    // 因为它会被相信。
    setPolicy({ ...STATIC_POLICY, source: 'fallback', version: 'fallback' });
    expect(buildProvenance().policy_source).toBe('fallback');
    expect(buildProvenance().policy_source).not.toBe('remote');
  });

  it('carries the assistant when one is known', () => {
    expect(buildProvenance('word-creator').assistant_id).toBe('word-creator');
  });

  it('omits the assistant rather than inventing one', () => {
    expect(buildProvenance()).not.toHaveProperty('assistant_id');
  });

  it('serialises into the header LiteLLM actually records', () => {
    // 实测：x-litellm-spend-logs-metadata 原样落进 SpendLogs 的 spend_logs_metadata。
    // 自定义 x-cynapse-* header 不会被记录——LiteLLM 的 requester_custom_headers
    // 只收白名单内的。
    setPolicy({ ...STATIC_POLICY, capabilities: { ...DEFAULT_CAPABILITIES } });
    const h = provenanceHeaders('word-creator');
    expect(Object.keys(h)).toEqual([SPEND_LOGS_METADATA_HEADER]);
    expect(JSON.parse(h[SPEND_LOGS_METADATA_HEADER])).toMatchObject({
      assistant_id: 'word-creator',
      policy_source: 'static',
    });
  });

  it('sends nothing rather than something invented when it cannot serialise', () => {
    // provenance 缺失是数据质量问题，不该让员工发不出消息（FR-7 可用性失败开放）。
    // 但也绝不发一个编出来的。
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    setPolicy({ ...STATIC_POLICY, version: circular as unknown as string });
    const h = provenanceHeaders();
    expect(h[SPEND_LOGS_METADATA_HEADER] ?? '').not.toContain('undefined');
  });
});
