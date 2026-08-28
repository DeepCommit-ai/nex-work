/**
 * [ENTERPRISE PATCH] 部门配置的取与报 —— 纯 HTTP，无 IPC、无 React。
 *
 * Spec: cynapse `doc/spec/2026-08-27-服务端控制agent-design.md`（FR-1、FR-8）
 *
 * fetch 以参数注入，测试不需要网络。所有失败都收敛成 `FetchResult.failed`，
 * 且 detail 必须能区分"key 无效"“连不上”“响应坏了"——这三种失败的处置完全不同
 * （换 key / 查网络 / 查服务端），混在一起等于都查不了。
 */

import { SPEND_LOGS_METADATA_HEADER } from '../capabilities/provenance';
import type { ApplyReport, DeptConfig, FetchResult } from './types';

export const CYNAPSE_KEY_HEADER = 'X-Cynapse-Key';

type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

const normalizeServerUrl = (serverUrl: string): string => serverUrl.trim().replace(/\/+$/, '');

/** 拉取本部门的配置。失败绝不降级成一份"看起来正常"的配置（服务端契约同款）。 */
export const fetchDeptConfig = async (
  serverUrl: string,
  deptKey: string,
  fetchFn: FetchLike = fetch
): Promise<FetchResult> => {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchFn(`${normalizeServerUrl(serverUrl)}/config`, {
      headers: { [CYNAPSE_KEY_HEADER]: deptKey },
    });
  } catch (e) {
    return { status: 'failed', detail: `连不上配置服务：${e instanceof Error ? e.message : String(e)}` };
  }
  if (res.status === 401) {
    return { status: 'failed', httpStatus: 401, detail: 'key 无效或已停用' };
  }
  if (!res.ok) {
    return { status: 'failed', httpStatus: res.status, detail: `配置服务返回 ${res.status}` };
  }
  try {
    const config = (await res.json()) as DeptConfig;
    return { status: 'ok', config, etag: res.headers.get('ETag') ?? undefined };
  } catch {
    return { status: 'failed', httpStatus: res.status, detail: '配置服务的响应不是合法 JSON' };
  }
};

/**
 * 静态 provenance —— 写进 agent env_override 的 `ANTHROPIC_CUSTOM_HEADERS` 值。
 *
 * 实测（2026-08-27）：Claude Code 会把这个环境变量里的 header 原样发给网关，
 * `x-litellm-spend-logs-metadata` 的 JSON 落进 `SpendLogs.metadata.spend_logs_metadata`
 * 与 Langfuse 事件的 `attributes.metadata`。这条通道是**每次 spawn 静态**的：
 * 它答"哪个部门、哪版配置、哪台机器"，不答"哪个助手"——per-request 的那半
 * 走 `provenanceHeaders()`（aionrs 路径）。
 */
export const buildProvenanceEnvValue = (p: { dept: string; configVersion: string; clientId: string }): string =>
  `${SPEND_LOGS_METADATA_HEADER}: ${JSON.stringify({
    dept: p.dept,
    config_version: p.configVersion,
    client_id: p.clientId,
    client: 'nexwork',
  })}`;

/**
 * ApplyReport → `/report` 的 body。
 *
 * 字段名是与 cynapse `server/apply.py::to_report_body` 的**双向契约**：服务端按
 * `applied_version` / `agents_enabled` / `assistants_enabled` 取值比对。上报动作
 * 集合（agentsEnabled）而不是实际状态（finalAgents）的话，幂等重放的第二次会
 * 上报空集，服务端把它读成"全部缺失"——字段对不上比连不上更糟，它安静地给出
 * 错误结论。
 */
export const toReportBody = (rep: ApplyReport, clientId: string): Record<string, unknown> => ({
  client_id: clientId,
  applied_version: rep.version,
  agents_enabled: rep.finalAgents,
  assistants_enabled: rep.finalAssistants,
  failures: rep.failures,
});

/** 回读上报。上报失败不阻塞使用——但必须把失败带回给调用方展示，不静默。 */
export const postReport = async (
  serverUrl: string,
  deptKey: string,
  body: Record<string, unknown>,
  fetchFn: FetchLike = fetch
): Promise<{ ok: boolean; drift: string[]; detail?: string }> => {
  try {
    const res = await fetchFn(`${normalizeServerUrl(serverUrl)}/report`, {
      method: 'POST',
      headers: { [CYNAPSE_KEY_HEADER]: deptKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, drift: [], detail: `上报被拒（${res.status}）` };
    const d = (await res.json()) as { ok?: boolean; drift?: string[] };
    return { ok: Boolean(d.ok), drift: d.drift ?? [] };
  } catch (e) {
    return { ok: false, drift: [], detail: `上报没送出去：${e instanceof Error ? e.message : String(e)}` };
  }
};
