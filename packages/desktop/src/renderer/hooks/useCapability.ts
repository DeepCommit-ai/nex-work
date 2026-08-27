/**
 * [ENTERPRISE PATCH] Capability policy — the renderer's read path.
 *
 * Spec: specs/002-server-controlled-capabilities/spec.md (FR-1, FR-2)
 *
 * The whole vocabulary at a gating call site is a capability key. Nothing here
 * exposes the provider that answered, which is what makes "swapping static →
 * remote changes no call site" a claim a diff can check.
 *
 * `useSyncExternalStore` rather than a context: pure utilities outside the React
 * tree read the same store through `can()`, and two sources of truth for the
 * same policy would drift the moment one of them was flipped at runtime.
 */

import { getPolicy, subscribePolicy } from '@/common/capabilities/policy';
import type { CapabilityKey, CapabilityPolicy } from '@/common/capabilities/types';
import { useSyncExternalStore } from 'react';

/** Read one capability. Re-renders the caller when the policy changes (no restart). */
export const useCapability = (key: CapabilityKey): boolean =>
  useSyncExternalStore(
    subscribePolicy,
    () => getPolicy().capabilities[key],
    () => getPolicy().capabilities[key]
  );

/** The whole policy — for provenance on outgoing requests (FR-8), not for gating. */
export const useCapabilityPolicy = (): CapabilityPolicy => useSyncExternalStore(subscribePolicy, getPolicy, getPolicy);
