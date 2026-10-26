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

/**
 * Claude Code 的自定义请求头（换行分隔的 `Name: Value`）。
 *
 * provenance（002 FR-8）的注入点：实测 `ANTHROPIC_CUSTOM_HEADERS` 里的
 * `x-litellm-spend-logs-metadata` 会被 Claude Code 原样发给网关，落进
 * `SpendLogs.metadata.spend_logs_metadata` 与 Langfuse 事件元数据。
 * 由同一个 buildEnvOverride 管理，理由同 CONFIG_DIR：env_override 是单一存储，
 * 两个写入方会把对方的变量当成无主条目互相覆盖。
 */
export const GATEWAY_ENV_CUSTOM_HEADERS = 'ANTHROPIC_CUSTOM_HEADERS';

/**
 * The department's model for Claude Code, written to every name Claude Code resolves a
 * model from: the session default and the opus/sonnet/haiku aliases its model picker and
 * background tasks use.
 *
 * Pinning the model on the conversation is not enough: aioncore only accepts models from
 * Claude Code's own catalog (default/opus/sonnet/haiku), drops a gateway alias such as
 * `glm-5.3-flash` and starts the session on Claude's default name (aioncore log
 * "persisted model selection is absent from the agent's catalog", 2026-10-19).
 * Through the gateway a wildcard route happened to map that name back; direct to the
 * upstream it did not. Spec 012; cynapse spec §17.
 */
export const GATEWAY_ENV_CLAUDE_MODELS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
] as const;

/**
 * Claude Code's model catalog as aioncore caches it once the aliases are mapped to gateway models:
 * the only session models aioncore passes on (spec 014). `opus[1m]` is not in it (aioncore logs
 * "persisted model selection is absent from the agent's catalog" and falls back, measured
 * 2026-10-23), so a 1M window travels in the slot's value instead: `glm-5.3[1m]`.
 */
export const CLAUDE_CODE_MODEL_IDS = ['default', 'opus', 'sonnet', 'haiku'] as const;

/** A slot value may carry Claude Code's 1M marker; the gateway alias is the part before it. */
export const gatewayModelOf = (slotValue: string): string => slotValue.replace(/\[1m\]$/i, '');

/** Slots a department can map to a model of its own (cynapse `gateway.claude_slots`, spec 014). */
export const CLAUDE_SLOT_ENV = {
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
} as const;

export type ClaudeSlots = Partial<Record<keyof typeof CLAUDE_SLOT_ENV, string>>;

/**
 * Claude Code's default context window for gateway models (cynapse `gateway.claude_context_tokens`,
 * spec 018). Bundled Claude Code 2.1.235 sizes a model's window as: `[1m]` suffix → 1,000,000; else,
 * for a name not starting with `claude-`, this variable; else 200,000. Auto-compact follows the
 * window. Measured 2026-10-26 with 262144: `k3.1-pro` reports contextWindow 262144 and
 * `k3.1-pro[1m]` still 1000000.
 *
 * `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is deliberately not managed: Claude Code takes
 * min(model window, that value) for every session, so it would also cut a `[1m]` slot's sessions
 * (spec 014) down to the same compaction point.
 */
export const GATEWAY_ENV_CLAUDE_CONTEXT_TOKENS = 'CLAUDE_CODE_MAX_CONTEXT_TOKENS';

/** Largest window cynapse may serve in `gateway.claude_context_tokens` (validateConfig, spec 018). */
export const CLAUDE_CONTEXT_TOKENS_MAX = 1_048_576;

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
  /**
   * Value for ANTHROPIC_CUSTOM_HEADERS (provenance). Empty means "keep what is
   * there": the manual gateway settings page never computes provenance, and a
   * manual save must not silently strip what the dept-config apply wrote.
   */
  customHeadersValue?: string;
  /**
   * Model for GATEWAY_ENV_CLAUDE_MODELS. `undefined` keeps what is there (the manual
   * gateway page knows nothing about it); `null` or empty clears it (the department
   * pins nothing); a value sets every name.
   */
  claudeModel?: string | null;
  /**
   * Slots mapped to a model other than `claudeModel` (spec 014), e.g. `{ opus: 'glm-5.3[1m]' }` for
   * the one assistant whose sessions select `opus`. Only read when `claudeModel` is not `undefined`.
   */
  claudeSlots?: ClaudeSlots | null;
  /**
   * Context window for GATEWAY_ENV_CLAUDE_CONTEXT_TOKENS (spec 018), e.g. 262144. Only read when
   * `claudeModel` is not `undefined`; then `null` or absent removes the variable, which puts Claude
   * Code back on its own 200k.
   */
  claudeContextTokens?: number | null;
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
