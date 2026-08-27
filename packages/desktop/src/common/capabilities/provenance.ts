/**
 * [ENTERPRISE PATCH] 请求 provenance（002 FR-8）。
 *
 * Spec: specs/002-server-controlled-capabilities/spec.md FR-8
 *
 * FR-8 存在的全部理由，是让语料事后能分成"服务端路由了这条"和"本地默认路由的"。
 * 没有它，最想拿来训练的那批最早的网关日志永远无法归因——而**补晚了就补不上了**，
 * 已经产生的记录不会追溯地长出这些字段。
 *
 * ## 载体
 *
 * 走 `x-litellm-spend-logs-metadata` header：LiteLLM 把它原样落进
 * `LiteLLM_SpendLogs.metadata.spend_logs_metadata`。
 *
 * 实测过一条更直觉的路并**排除**了：自定义 `x-cynapse-*` header 不会被记录，
 * LiteLLM 的 `requester_custom_headers` 只收白名单内的（`x-claude-code-*`、
 * `x-stainless-*`、`x-app`）。
 */

import { getPolicy } from './policy';

/** LiteLLM 会把这个 header 的 JSON 原样落进 SpendLogs。 */
export const SPEND_LOGS_METADATA_HEADER = 'x-litellm-spend-logs-metadata';

export type Provenance = {
  /** 哪个助手发起的。没有它就答不了"这条语料是干什么的"。 */
  assistant_id?: string;
  policy_version: string;
  /**
   * 策略从哪来。
   *
   * **绝不能是 provider 的名字。** 第一版在拉取失败时报的是 provider 名，于是一个
   * 返回 401 的 remote source 仍然记成 `remote`——记录声称服务端做了决定，而服务端
   * 一个字都没说。已修（`6cced5fb`），这里沿用同一约定：失败时是 `fallback`。
   */
  policy_source: string;
};

/**
 * 组装 provenance。
 *
 * 静态 provider 下也要发：这份 spec 明写"Provenance is sent before there is anything
 * but `static` to report"——因为它必须能在事后区分两者，而不是只在有远端时才有意义。
 */
export const buildProvenance = (assistantId?: string): Provenance => {
  const p = getPolicy();
  return {
    ...(assistantId ? { assistant_id: assistantId } : {}),
    policy_version: p.version,
    policy_source: p.source,
  };
};

/**
 * 生成要附加到网关请求上的 header。
 *
 * 返回空对象而不是抛错：provenance 缺失是数据质量问题，不该成为员工发不出消息的
 * 原因（002 FR-7 的"可用性失败开放"）。但它**不会静默地发一个假的**——
 * 序列化失败时宁可不发，也不发一个编出来的。
 */
export const provenanceHeaders = (assistantId?: string): Record<string, string> => {
  try {
    return { [SPEND_LOGS_METADATA_HEADER]: JSON.stringify(buildProvenance(assistantId)) };
  } catch {
    return {};
  }
};
