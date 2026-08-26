/**
 * [ENTERPRISE PATCH] Gateway provisioning — pure logic.
 *
 * Spec: specs/006-gateway-provisioning/spec.md (FR-2, FR-4)
 *
 * Kept free of IPC and React so it can be tested without a running backend.
 * Callers pass the current overrides in and apply the returned ones.
 */

import type { EnvEntry, GatewayConfig, GatewayState, RuntimeGatewayStatus } from './types';
import { GATEWAY_ENV_AUTH_TOKEN, GATEWAY_ENV_BASE_URL } from './types';

const findEntry = (entries: readonly EnvEntry[], name: string): EnvEntry | undefined =>
  entries.find((e) => e.name === name);

/** Normalise for comparison: trailing slashes and surrounding space are not meaningful. */
const normalizeUrl = (url: string): string => url.trim().replace(/\/+$/, '');

/**
 * Classify one runtime against the configured gateway (FR-3, FR-4).
 *
 * `overridden` is reserved for a base URL that points somewhere else. A missing
 * or empty value is `unset`, never silently treated as agreement.
 */
export const classifyRuntime = (
  entries: readonly EnvEntry[],
  gatewayBaseUrl: string
): { state: GatewayState; currentValue?: string } => {
  const current = findEntry(entries, GATEWAY_ENV_BASE_URL)?.value?.trim() ?? '';
  if (!current) return { state: 'unset' };
  if (normalizeUrl(current) === normalizeUrl(gatewayBaseUrl)) return { state: 'gateway' };
  return { state: 'overridden', currentValue: current };
};

/**
 * Produce the env override list that points a runtime at the gateway (FR-2).
 *
 * Entries unrelated to the gateway are preserved untouched — a runtime may carry
 * proxy settings, locale, or anything else the user put there.
 *
 * An empty `apiKey` means "keep whatever token is already set" (FR-6): the UI
 * never reads the key back, so a save that did not re-enter it must not wipe it.
 */
export const buildEnvOverride = (existing: readonly EnvEntry[], config: GatewayConfig): EnvEntry[] => {
  const managed = new Set<string>([GATEWAY_ENV_BASE_URL, GATEWAY_ENV_AUTH_TOKEN]);
  const preserved = existing.filter((e) => !managed.has(e.name));
  const token = config.apiKey.trim()
    ? config.apiKey.trim()
    : (findEntry(existing, GATEWAY_ENV_AUTH_TOKEN)?.value ?? '');

  const next: EnvEntry[] = [...preserved, { name: GATEWAY_ENV_BASE_URL, value: normalizeUrl(config.baseUrl) }];
  if (token) next.push({ name: GATEWAY_ENV_AUTH_TOKEN, value: token });
  return next;
};

/**
 * Decide which runtimes a save should write to (FR-4).
 *
 * A runtime whose base URL points elsewhere is **not** rewritten unless the user
 * explicitly resolved that conflict — silently replacing a value the user typed
 * is how a settings screen loses trust.
 */
export const planProvisioning = (
  runtimes: readonly { runtimeId: string; runtimeName: string; env: readonly EnvEntry[] }[],
  config: GatewayConfig,
  resolvedConflicts: readonly string[] = []
): { statuses: RuntimeGatewayStatus[]; toWrite: { runtimeId: string; env: EnvEntry[] }[] } => {
  const resolved = new Set(resolvedConflicts);
  const statuses: RuntimeGatewayStatus[] = [];
  const toWrite: { runtimeId: string; env: EnvEntry[] }[] = [];

  for (const r of runtimes) {
    const { state, currentValue } = classifyRuntime(r.env, config.baseUrl);
    statuses.push({ runtimeId: r.runtimeId, runtimeName: r.runtimeName, state, currentValue });
    const blockedByConflict = state === 'overridden' && !resolved.has(r.runtimeId);
    if (!blockedByConflict) toWrite.push({ runtimeId: r.runtimeId, env: buildEnvOverride(r.env, config) });
  }
  return { statuses, toWrite };
};

/** True when every runtime reaches the gateway — the condition collection depends on. */
export const isFullyProvisioned = (statuses: readonly RuntimeGatewayStatus[]): boolean =>
  statuses.length > 0 && statuses.every((s) => s.state === 'gateway');
