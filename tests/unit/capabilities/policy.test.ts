import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  can,
  DEFAULT_CAPABILITIES,
  getPolicy,
  normalizePolicy,
  resolvePolicy,
  setPolicy,
  STATIC_POLICY,
  staticPolicyProvider,
  subscribePolicy,
} from '@/common/capabilities/policy';
import type { PolicyProvider } from '@/common/capabilities/types';

afterEach(() => setPolicy(STATIC_POLICY));

describe('the shipped policy', () => {
  it('conceals everything it can', () => {
    // A default that left CLIs visible would make the gated path the one nobody
    // exercises, which is how gating rots.
    expect(Object.values(DEFAULT_CAPABILITIES).every((v) => v === false)).toBe(true);
  });

  it('carries the fields a remote provider will need', () => {
    // FR-2: adding a remote provider must change no consumer, so the static one
    // fills these in rather than leaving consumers to learn about them later.
    expect(STATIC_POLICY).toMatchObject({ version: expect.any(String), source: 'static', ttl: 0 });
  });
});

describe('normalizePolicy', () => {
  it('fills a missing key from the shipped default rather than reading it as false', () => {
    const p = normalizePolicy({ capabilities: { 'cli.visible': true } }, 'remote');
    expect(p.capabilities['cli.visible']).toBe(true);
    expect(p.capabilities['model.userSelectable']).toBe(DEFAULT_CAPABILITIES['model.userSelectable']);
  });

  it('ignores an unknown key instead of widening the vocabulary', () => {
    const p = normalizePolicy({ capabilities: { 'wat.nope': true } }, 'remote');
    expect('wat.nope' in p.capabilities).toBe(false);
  });

  it('ignores a non-boolean value', () => {
    // A remote payload is untrusted input; `"true"` must not enable anything.
    const p = normalizePolicy({ capabilities: { 'cli.visible': 'true' } }, 'remote');
    expect(p.capabilities['cli.visible']).toBe(false);
  });

  it('records the source it was told, not one the payload claims', () => {
    // FR-8: a static policy must never be reported as a server decision.
    const p = normalizePolicy({ source: 'remote' }, 'static');
    expect(p.source).toBe('static');
  });

  it('survives a payload that is not an object at all', () => {
    expect(normalizePolicy(null, 'remote').capabilities).toEqual(DEFAULT_CAPABILITIES);
    expect(normalizePolicy('nonsense', 'remote').capabilities).toEqual(DEFAULT_CAPABILITIES);
  });
});

describe('resolvePolicy', () => {
  it('returns what the provider resolves', async () => {
    expect((await resolvePolicy(staticPolicyProvider)).capabilities).toEqual(DEFAULT_CAPABILITIES);
  });

  it('degrades to concealment when the provider throws, rather than propagating', async () => {
    // FR-7: an outage must not reveal identity, and must not take the app down.
    const broken: PolicyProvider = { name: 'remote', resolve: () => Promise.reject(new Error('down')) };
    const p = await resolvePolicy(broken);
    expect(p.capabilities['cli.visible']).toBe(false);
    expect(p.version).toBe('fallback');
  });

  it('never reports the provider name as the source when the provider failed', async () => {
    // The first version returned `source: provider.name`, so a remote source that
    // answered 401 still recorded `source: 'remote'` — provenance claiming the
    // server decided something it never said. FR-8 exists to split a corpus into
    // "server routed this" and "a local default did"; that split is only possible
    // if a failure is not indistinguishable from an answer.
    const broken: PolicyProvider = { name: 'remote', resolve: () => Promise.reject(new Error('401')) };
    const p = await resolvePolicy(broken);
    expect(p.source).toBe('fallback');
    expect(p.source).not.toBe('remote');
    expect(p.failedProvider).toBe('remote');
  });

  it('reports the real source when the provider answered', async () => {
    const p = await resolvePolicy(staticPolicyProvider);
    expect(p.source).toBe('static');
    expect(p.failedProvider).toBeUndefined();
  });
});

describe('the read store', () => {
  it('notifies subscribers so a flipped key re-renders without a restart', () => {
    const seen = vi.fn();
    const unsubscribe = subscribePolicy(seen);
    setPolicy({ ...STATIC_POLICY, capabilities: { ...DEFAULT_CAPABILITIES, 'cli.visible': true } });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(can('cli.visible')).toBe(true);
    unsubscribe();
    setPolicy(STATIC_POLICY);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('reads the same values through can() as through getPolicy()', () => {
    // Utilities outside React read through can(); two sources of truth for one
    // policy would drift the moment a key was flipped at runtime.
    setPolicy({ ...STATIC_POLICY, capabilities: { ...DEFAULT_CAPABILITIES, 'model.userSelectable': true } });
    expect(can('model.userSelectable')).toBe(getPolicy().capabilities['model.userSelectable']);
  });
});

describe('normalizePolicy — agentNames（issue #9）', () => {
  it('carries sane entries through and drops garbage — a bad map must mean "no rename", never a broken UI', () => {
    const p = normalizePolicy(
      { version: 'v6', capabilities: {}, agentNames: { a1: ' 通用引擎 ', a2: '', a3: 42 as unknown as string } },
      'remote'
    );
    expect(p.agentNames).toEqual({ a1: '通用引擎' });
  });

  it('omits the field entirely when nothing survives', () => {
    const p = normalizePolicy({ version: 'v6', capabilities: {}, agentNames: { a: '' } }, 'remote');
    expect(p.agentNames).toBeUndefined();
  });
});
