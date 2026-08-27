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

/**
 * Where the company's Claude Code keeps its own config, separate from the
 * employee's `~/.claude/`.
 *
 * `command_override` isolates the *binary* and nothing else: the spawned process
 * still inherits `HOME`, so it reads and writes the employee's own credentials,
 * settings, session history and MCP config. Measured on a live instance — the
 * employee's `~/.claude/.credentials.json` holds a personal OAuth login, and the
 * company install was using it.
 *
 * It is managed here, in the same writer as the gateway vars, because
 * `env_override` is a single store: two independent writers would each see the
 * other's variable as an unmanaged entry and fight over it.
 *
 * Setting it also **moves the transcripts** — they land under
 * `$CLAUDE_CONFIG_DIR/projects/` instead of `~/.claude/projects/`. The collector
 * must be pointed at the same place, or it finds nothing and reports a clean
 * zero (see cynapse `doc/静默失败.md`).
 */
export const GATEWAY_ENV_CONFIG_DIR = 'CLAUDE_CONFIG_DIR';

/** The single gateway configuration for this install. */
export type GatewayConfig = {
  baseUrl: string;
  /** Empty string means "unchanged" on save — the key is write-only (FR-6). */
  apiKey: string;
  /**
   * Company-private Claude Code config directory. Empty means "do not manage it"
   * — an existing value on a runtime is then left alone rather than cleared.
   */
  configDir?: string;
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
  /**
   * Whether this runtime keeps its config apart from the employee's own.
   *
   * Reported beside `state` rather than folded into it: reaching the gateway and
   * being isolated are different properties, and a runtime can have one without
   * the other. Folding them would repeat the mistake the green "reaches the
   * gateway" tag already made once — asserting a health it had not checked.
   */
  isolated?: boolean;
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
