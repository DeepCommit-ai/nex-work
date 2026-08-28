/**
 * [ENTERPRISE PATCH] 部门配置落实 —— 纯逻辑。
 *
 * Spec: cynapse `doc/spec/2026-08-27-服务端控制agent-design.md`（FR-2、FR-2b、FR-2c）
 *
 * 与 006 一样，不含 IPC 与 React：调用方把当前状态传进来、把要写的操作拿出去。
 * 这样"半途崩溃留下什么"能被测出来，而那正是这套方案唯一真正的风险。
 *
 * ## 为什么必须全量重放（FR-2b）
 *
 * 两层的生效范围不同：`agent_metadata.enabled` 是机器级，`assistant_overlays` 是
 * 按用户。半途崩溃会留下跨层不一致，而**没有任何东西会重跑**。所以不做增量：
 * 每次启动按最新配置全量重放，重放必须幂等。
 *
 * ## 顺序是被测行为，不是实现细节
 *
 * 1. 先启用要启用的 agent
 * 2. 改指 + 启用助手
 * 3. 停用其余助手
 * 4. **最后**停用其余 agent
 *
 * 反过来的话，崩在中间会留下"全都停了、还没启用"（员工一个助手都没有），或者
 * "助手还在但它的 agent 已停"——界面上是报错卡片，且不会自行恢复。
 */

import type { ApplyReport, AssistantSpec, DeptConfig } from './types';

/** 落实需要知道的当前状态。 */
export type CurrentState = {
  agents: { id: string; enabled: boolean }[];
  assistants: {
    id: string;
    enabled: boolean;
    agent_id?: string | null;
    /**
     * 当前钉着的默认模型（`defaults.model.mode === 'fixed'` 时的 value）。
     * 列表 API 不带 defaults，这个字段由编排层对"配置里带 fixed_model 的助手"
     * 单独取 detail 填入；undefined = 没取到。**没取到时照样下钉**（幂等 PUT），
     * 宁可多写一次也不能把"读不到现状"静默当成"已经钉好"。
     */
    fixed_model?: string | null;
  }[];
};

/** 一个待执行的写操作。按数组顺序执行。 */
export type PlannedWrite =
  | { kind: 'agent.enable'; id: string }
  | { kind: 'agent.disable'; id: string }
  /** 本地没有这个 id 且配置带 name（完整定义）：按定义创建（issue #7）。 */
  | { kind: 'assistant.import'; id: string; spec: AssistantSpec }
  | { kind: 'assistant.repoint'; id: string; agentId: string }
  /** 把 defaults.model 钉成 fixed（issue #6）。 */
  | { kind: 'assistant.pin_model'; id: string; model: string }
  | { kind: 'assistant.enable'; id: string }
  | { kind: 'assistant.disable'; id: string };

/**
 * 配置本身是否可落实。
 *
 * 这是 FR-3b 的客户端侧防线。服务端已经校验过，但**服务端校验不是客户端执行破坏性
 * 操作前的最后防线**：反序列化默认值、缓存损坏、拿到一份旧的空响应，都会把
 * "缺字段"变成"显式的空全集"——而清单是全集，空全集意味着停用一切。
 */
export const validateConfig = (cfg: DeptConfig): string[] => {
  const problems: string[] = [];
  if (!cfg.version) problems.push('配置没有 version');
  if (!cfg.agents?.length) problems.push('agent 清单为空——会停用全部 agent，员工无法发出任何消息');
  if (!cfg.assistants?.length) problems.push('助手清单为空——员工会看到一个空界面');

  const pinned = (cfg.assistants ?? []).filter((a) => a.agent_id);
  if (cfg.assistants?.length && !pinned.length) {
    // FR-3b。21 个 builtin 助手默认全绑 aionrs，而 aionrs 流量没有 acp_session 行、
    // session_id 每次调用重新生成，因此语料无法归因——它会正常工作、正常计费、
    // 正常回答，只是产出的东西永远连不上 transcript。
    problems.push('没有任何助手改指到可采集的 agent——语料将无法归因');
  }
  const unknown = pinned.filter((a) => !cfg.agents.includes(a.agent_id!)).map((a) => a.id);
  if (unknown.length) {
    problems.push(`助手 ${unknown.join(', ')} 改指到不在启用清单里的 agent——界面上会是报错卡片且不会自行恢复`);
  }
  const badPin = (cfg.assistants ?? []).filter((a) => a.fixed_model && !cfg.model_aliases?.includes(a.fixed_model));
  if (badPin.length) {
    // 钉一个别名表里没有的模型，新会话在网关拿到 404——员工看到"发不出消息"。
    // 服务端也拦，这里是客户端执行前的最后防线（同一坏响应可能只坏一半）。
    problems.push(
      `助手 ${badPin.map((a) => a.id).join(', ')} 钉的 fixed_model 不在 model_aliases 里——新会话会在网关得到 404`
    );
  }
  if (!cfg.gateway?.base_url?.trim() || !cfg.gateway?.api_key?.trim()) {
    // 半份网关配置（有地址没 token，或全都没有）会让流量绕过网关或每次 401，
    // 且两种失败此刻都表现成"配置成功"。服务端已保证带全，缺了就是响应坏了。
    problems.push('配置没有可用的网关段（base_url/api_key）——流量将不经网关，既不计费也不采集');
  }
  return problems;
};

/**
 * 算出要执行的写操作。**只写差异**。
 *
 * 重放每次启动都跑，无条件写会白白刷新 `updated_at` 并扩大失败面。
 */
export const planWrites = (cfg: DeptConfig, current: CurrentState): PlannedWrite[] => {
  const wantAgents = new Set(cfg.agents);
  const wantAssistants = new Map<string, AssistantSpec>(cfg.assistants.map((a) => [a.id, a]));
  const byId = new Map(current.assistants.map((a) => [a.id, a]));

  const enableAgents: PlannedWrite[] = current.agents
    .filter((a) => wantAgents.has(a.id) && !a.enabled)
    .map((a) => ({ kind: 'agent.enable', id: a.id }));

  const assistantWrites: PlannedWrite[] = [];
  for (const spec of cfg.assistants) {
    const cur = byId.get(spec.id);
    if (!cur && spec.name?.trim()) {
      // 本地缺这个 id 且配置带定义：先 import 再 enable。import 自带
      // agent_id / fixed_model（创建载荷里就有），不再补 repoint/pin。
      assistantWrites.push({ kind: 'assistant.import', id: spec.id, spec });
      assistantWrites.push({ kind: 'assistant.enable', id: spec.id });
      continue;
    }
    // 本地缺、又没带定义：维持旧行为——enable 会在执行时如实失败进 failures。
    // 静默跳过会把"这台机器少一个助手"表现成"配置成功"。
    if (spec.agent_id && cur?.agent_id !== spec.agent_id) {
      assistantWrites.push({ kind: 'assistant.repoint', id: spec.id, agentId: spec.agent_id });
    }
    if (spec.fixed_model && cur && cur.fixed_model !== spec.fixed_model) {
      assistantWrites.push({ kind: 'assistant.pin_model', id: spec.id, model: spec.fixed_model });
    }
    if (!cur?.enabled) assistantWrites.push({ kind: 'assistant.enable', id: spec.id });
  }

  const disableAssistants: PlannedWrite[] = current.assistants
    .filter((a) => !wantAssistants.has(a.id) && a.enabled)
    .map((a) => ({ kind: 'assistant.disable', id: a.id }));

  // agent 最后停：助手还绑着它时先停，界面上会出现"该助手的 agent 不可用"。
  const disableAgents: PlannedWrite[] = current.agents
    .filter((a) => !wantAgents.has(a.id) && a.enabled)
    .map((a) => ({ kind: 'agent.disable', id: a.id }));

  return [...enableAgents, ...assistantWrites, ...disableAssistants, ...disableAgents];
};

/**
 * 从落实后的实际状态构造回读报告（FR-8）。
 *
 * 与"本轮动作"分开，因为它们回答不同问题：重放是幂等的，第二次跑动作列表会是空的
 * ——**空不代表没生效**。服务端要比对的是实际状态，用动作列表去比会把
 * "没有变化"读成"什么都没生效"。
 */
export const buildReport = (
  version: string,
  writes: PlannedWrite[],
  after: CurrentState,
  failures: string[]
): ApplyReport => ({
  version,
  agentsEnabled: writes.filter((w) => w.kind === 'agent.enable').map((w) => w.id),
  agentsDisabled: writes.filter((w) => w.kind === 'agent.disable').map((w) => w.id),
  assistantsEnabled: writes.filter((w) => w.kind === 'assistant.enable').map((w) => w.id),
  assistantsDisabled: writes.filter((w) => w.kind === 'assistant.disable').map((w) => w.id),
  repointed: writes.filter((w) => w.kind === 'assistant.repoint').map((w) => w.id),
  imported: writes.filter((w) => w.kind === 'assistant.import').map((w) => w.id),
  modelPinned: writes.filter((w) => w.kind === 'assistant.pin_model').map((w) => w.id),
  failures,
  finalAgents: after.agents
    .filter((a) => a.enabled)
    .map((a) => a.id)
    .toSorted(),
  finalAssistants: after.assistants
    .filter((a) => a.enabled)
    .map((a) => a.id)
    .toSorted(),
});
