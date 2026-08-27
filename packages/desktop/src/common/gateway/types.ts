/**
 * [ENTERPRISE PATCH] Gateway provisioning — shared types.
 *
 * Spec: specs/006-gateway-provisioning/spec.md
 *
 * One gateway (URL + key) provisions every runtime, so that all model traffic
 * reaches the company LiteLLM proxy. Collection happens gateway-side; a runtime
 * that routes around it leaves no record anywhere and the gap is undetectable
 * after the fact.
 */

/** Env var names a CLI agent reads to reach an Anthropic-compatible gateway. */
export const GATEWAY_ENV_BASE_URL = 'ANTHROPIC_BASE_URL';
export const GATEWAY_ENV_AUTH_TOKEN = 'ANTHROPIC_AUTH_TOKEN';

/** The single gateway configuration for this install. */
export type GatewayConfig = {
  baseUrl: string;
  /** Empty string means "unchanged" on save — the key is write-only (FR-6). */
  apiKey: string;
};

/**
 * Per-runtime provisioning state (FR-3).
 *
 * `unset` must be visually distinct from `gateway`: an unprovisioned runtime is
 * exactly the silent hole this spec exists to close.
 */
export type GatewayState = 'gateway' | 'unset' | 'overridden';

export type RuntimeGatewayStatus = {
  runtimeId: string;
  runtimeName: string;
  state: GatewayState;
  /** Present only when `state === 'overridden'` — the conflicting value (FR-4). */
  currentValue?: string;
};

/** An env override entry as the backend stores it. */
export type EnvEntry = { name: string; value: string };

/**
 * Outcome of probing the gateway before provisioning (FR-5, FR-7).
 *
 * The probe exists because a URL that merely *parses* tells us nothing: a typo
 * in the port persists happily, every runtime then reports `gateway`, and the
 * surface asserts a health it never checked. Either we got the gateway's model
 * list back, or we did not.
 */
export type GatewayProbe = { status: 'ok'; models: string[] } | { status: 'failed'; detail: string };

/**
 * LiteLLM advertises a `*` wildcard row next to real aliases. It is a
 * passthrough rule, not something anyone can select; offering it would put an
 * unsendable entry in the model list.
 */
export const GATEWAY_WILDCARD_MODEL = '*';
