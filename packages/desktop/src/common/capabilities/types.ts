/**
 * [ENTERPRISE PATCH] Server-controlled capability policy — types.
 *
 * Spec: specs/002-server-controlled-capabilities/spec.md
 *
 * The vocabulary at gating call sites is capability keys and nothing else. No
 * call site knows which provider answered, which is what makes FR-2's "swapping
 * static → remote changes no call site" checkable by diff rather than by trust.
 */

/**
 * What a policy can turn off.
 *
 * The split between the last two matters and is not cosmetic. `agent.settingsVisible`
 * governs whether a page can be *reached*; `provider.userConfigurable` governs
 * whether the gateway can be *written around*. The spec is explicit that UI
 * gating is not a security boundary — true of hiding a CLI's name, false of the
 * env editor, which is a free-form key/value form that accepts
 * `ANTHROPIC_BASE_URL` and thereby routes traffic off the gateway entirely.
 * Collapsing the two into one key means the day someone wants an admin to see
 * the settings page, they also get the write path back.
 */
export type CapabilityKey =
  /** CLI / runtime identity is perceivable: names, logos, badges, runtime pickers. */
  | 'cli.visible'
  /** The user picks a model. When off, the model comes from the assistant definition. */
  | 'model.userSelectable'
  /** Agent and model settings pages are reachable. */
  | 'agent.settingsVisible'
  /** Providers and agent environment can be edited — the write path to the gateway. */
  | 'provider.userConfigurable';

export type CapabilityMap = Record<CapabilityKey, boolean>;

/**
 * Where a policy came from. Recorded on every gateway request as provenance (FR-8).
 *
 * `fallback` is not a provider — it is what `resolvePolicy` reports when a
 * provider could not be reached or answered with nonsense. It exists because the
 * first version reported the *provider's* name in that case, so a remote source
 * that returned 401 still logged `source: 'remote'`: the record said the server
 * decided this, when the server had said nothing at all. Provenance that cannot
 * distinguish "the server said so" from "the server never answered" is worse
 * than no provenance, because it is believed.
 */
export type PolicySource = 'static' | 'cached' | 'remote' | 'fallback';

/**
 * Shaped for remote delivery from the start (FR-2, forward compatibility).
 *
 * `ttl` and `etag` are unused by the static provider and filled with fixed
 * values. They exist now so that adding a remote provider later changes no
 * consumer — and so the earliest gateway logs, the ones we most want for
 * training, are already attributable to a policy version.
 */
export type CapabilityPolicy = {
  version: string;
  source: PolicySource;
  /** Which provider failed, when `source` is `fallback`. Diagnostics only. */
  failedProvider?: PolicySource;
  ttl: number;
  etag: string;
  capabilities: CapabilityMap;
  /**
   * [cynapse issue #9] 服务端下发的 agent 显示名(id → 名)。builtin agent 没有
   * 改名 API(实测 PUT/PATCH 均 404,服务器实例只能手改 DB),所以改名走显示层:
   * /config 携带 → 存进 policy → resolveAgentDisplayName() 在渲染时替换。
   */
  agentNames?: Record<string, string>;
};

/** Resolves a policy. Implementations: static (ships now), cached, remote. */
export type PolicyProvider = {
  readonly name: PolicySource;
  resolve(): Promise<CapabilityPolicy>;
};
