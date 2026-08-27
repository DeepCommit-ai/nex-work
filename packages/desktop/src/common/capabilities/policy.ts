/**
 * [ENTERPRISE PATCH] Capability policy — resolution and the read store.
 *
 * Spec: specs/002-server-controlled-capabilities/spec.md (FR-1, FR-2, FR-6, FR-7)
 *
 * Kept free of React and IPC so the resolution rules can be tested without a
 * renderer. The hook in `renderer/hooks/useCapability.ts` is a thin subscription
 * on top of the store below.
 */

import type { CapabilityKey, CapabilityMap, CapabilityPolicy, PolicyProvider, PolicySource } from './types';

/**
 * What ships.
 *
 * Everything the spec can gate is gated. This is not a cautious default: the
 * product's premise is that clerical staff never think in terms of CLIs, and a
 * default that leaves them visible would make the gated path the exception that
 * nobody exercises.
 */
export const DEFAULT_CAPABILITIES: CapabilityMap = {
  'cli.visible': false,
  'model.userSelectable': false,
  'agent.settingsVisible': false,
  'provider.userConfigurable': false,
};

/**
 * What concealment degrades *to* when nothing can be resolved (FR-7).
 *
 * Concealment fails closed and operability fails open, which is why this is not
 * simply `DEFAULT_CAPABILITIES`: identity stays hidden, but nothing here can be
 * the reason a message cannot be sent. Every gate built on these keys must keep
 * a resolvable default behind it — that requirement lives at the call sites,
 * because a map of booleans cannot enforce it.
 */
export const FALLBACK_CAPABILITIES: CapabilityMap = { ...DEFAULT_CAPABILITIES };

export const STATIC_POLICY: CapabilityPolicy = {
  version: 'static-1',
  source: 'static',
  // A static policy never expires; it is replaced by shipping a new build.
  ttl: 0,
  etag: 'static-1',
  capabilities: DEFAULT_CAPABILITIES,
};

/**
 * The provider that ships today.
 *
 * It is static because there is no server-to-client channel yet, not because a
 * remote one was skipped for convenience — see the spec's Boundaries section.
 */
export const staticPolicyProvider: PolicyProvider = {
  name: 'static',
  resolve: () => Promise.resolve(STATIC_POLICY),
};

/**
 * Normalise anything a provider returns into a usable policy.
 *
 * A remote payload is untrusted input: a missing key must not read as `false`
 * by accident, and an unknown key must not widen the vocabulary. Both are
 * resolved against the shipped defaults so a malformed response degrades to
 * "conceal", never to "reveal".
 */
export const normalizePolicy = (raw: unknown, source: PolicySource): CapabilityPolicy => {
  const r = (raw ?? {}) as Partial<CapabilityPolicy>;
  const incoming = (r.capabilities ?? {}) as Partial<CapabilityMap>;
  const capabilities = { ...DEFAULT_CAPABILITIES };
  for (const key of Object.keys(DEFAULT_CAPABILITIES) as CapabilityKey[]) {
    if (typeof incoming[key] === 'boolean') capabilities[key] = incoming[key];
  }
  return {
    version: typeof r.version === 'string' && r.version ? r.version : 'unknown',
    source,
    ttl: typeof r.ttl === 'number' && Number.isFinite(r.ttl) ? r.ttl : 0,
    etag: typeof r.etag === 'string' ? r.etag : '',
    capabilities,
  };
};

/**
 * Resolve a policy, degrading rather than throwing (FR-7).
 *
 * A provider that rejects, hangs or returns nonsense must not take the app down
 * with it: the caller gets a policy that conceals, and the app stays operable.
 */
export const resolvePolicy = async (provider: PolicyProvider): Promise<CapabilityPolicy> => {
  try {
    return normalizePolicy(await provider.resolve(), provider.name);
  } catch {
    // `source: 'fallback'`, never the provider's name. Reporting `'remote'` here
    // would record "the server decided this" for a request the server never
    // answered — and FR-8 exists precisely so that a corpus can later be split
    // into "server routed this" and "a local default did".
    return {
      version: 'fallback',
      source: 'fallback',
      failedProvider: provider.name,
      ttl: 0,
      etag: '',
      capabilities: FALLBACK_CAPABILITIES,
    };
  }
};

// ── The read store ────────────────────────────────────────────────────────

let current: CapabilityPolicy = STATIC_POLICY;
const listeners = new Set<() => void>();

/**
 * Install a resolved policy. The only writer; the renderer never calls it
 * (FR-1 — the renderer's view of the policy is read-only).
 */
export const setPolicy = (policy: CapabilityPolicy): void => {
  current = policy;
  for (const l of listeners) l();
};

export const getPolicy = (): CapabilityPolicy => current;

export const subscribePolicy = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Read one capability outside React.
 *
 * Pure utilities — `resolveAgentLogo` and friends — are consumed by components
 * that will re-render anyway when the store changes, so they read through this
 * rather than carrying a policy argument through every signature.
 */
export const can = (key: CapabilityKey): boolean => current.capabilities[key];
