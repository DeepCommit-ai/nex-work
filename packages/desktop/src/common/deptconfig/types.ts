/**
 * [ENTERPRISE PATCH] 部门配置下发 —— 类型。
 *
 * Spec: cynapse `doc/spec/2026-08-27-服务端控制agent-design.md`
 *
 * 服务端按部门 key 返回该部门允许使用的 agent 与助手清单；客户端拉到后自己去调
 * NexWork 的本地 API 落实（方案 A）。这样零 Rust 改动，改动落在我们自己维护的那一层。
 */

/**
 * 一个要对员工可见的助手。
 *
 * 只有 id（+ agent_id）时是"引用"：本地必须已有这个助手，缺了就是落实失败。
 * 带 name 时是"定义"（cynapse issue #7）：本地没有这个 id 就按它创建——
 * 新装机器长出与服务器一致的助手，而不是依赖某台机器的手工记录。
 */
export type AssistantSpec = {
  id: string;
  /**
   * 它应当跑在哪个 agent 上。留空表示不改指。
   *
   * 这个字段是 FR-3b 的载体：21 个 builtin 助手默认全绑 aionrs，而 aionrs 流量没有
   * `acp_session` 行、`session_id` 每次调用重新生成，因此**语料无法归因**。不改指的话，
   * 员工日常用的每一个助手产出的语料都连不上 transcript——而它会正常工作、正常计费、
   * 正常回答。
   */
  agent_id?: string | null;
  /** 显示名。有值 = 这条是可 import 的完整定义。 */
  name?: string | null;
  description?: string | null;
  /** 头像。留空 = 首字头像，不带厂商 logo。 */
  avatar?: string | null;
  /**
   * 钉死该助手新会话的默认模型（落成 `defaults.model = {mode:'fixed'}`）。
   * 用途见 cynapse issue #6：glm-5.3 在 aionrs 工具协议下"工具失明"，
   * Butler 必须钉回 glm-4.7。不写 = 不碰本地的 defaults。
   */
  fixed_model?: string | null;
};

/**
 * /config 的网关段。
 *
 * 员工只输入一个部门 key；访问网关的虚拟 key（带 team_id，部门归因靠它）、
 * Claude Code 的隔离目录，都由服务端在这里下发。没有它的配置会被 validateConfig
 * 拒绝：半份网关配置（写了 base_url、token 落空）比没有更难排查。
 */
export type GatewaySection = {
  base_url: string;
  api_key: string;
  /** Claude Code 的隔离目录（FR-5）。空 = 不隔离，transcript 落员工个人目录，采集器不看那里。 */
  config_dir?: string;
};

/** 服务端返回的一份部门配置。 */
export type DeptConfig = {
  version: string;
  dept: string;
  /**
   * 允许启用的 agent 全集。**不在其中的一律停用。**
   *
   * 是全集不是增量：只给"要停用的"是不够的——20/21 个 builtin 助手出厂即停用，
   * 单向清单会得到一个只剩 1 个助手的界面。
   */
  agents: string[];
  /** 要对员工可见的助手全集。同样，不在其中的一律停用。 */
  assistants: AssistantSpec[];
  /** LiteLLM 别名。客户端不用它做决定，仅供展示与排错。 */
  model_aliases: string[];
  /** 网关凭据（见 GatewaySection）。旧服务端可能没有——validateConfig 会把缺失报成问题。 */
  gateway?: GatewaySection;
  /** 002 的能力开关。落实成功后喂给 policy store（normalizePolicy 会兜住缺键与未知键）。 */
  capabilities?: Record<string, boolean>;
  /**
   * agent 显示名(id → 名),issue #9。builtin agent 没有改名 API,
   * 改名在渲染层生效(policy.agentNames → resolveAgentDisplayName)。
   */
  agent_names?: Record<string, string> | null;
};

/**
 * 拉取结果。
 *
 * `failed` 必须与"服务端就是这么说的"可区分——这是 002 已经踩过的坑：
 * `resolvePolicy` 原本在失败时报 `source: provider.name`，于是 401 也记成
 * `source: 'remote'`，记录声称服务端做了决定而服务端一个字都没说。
 */
export type FetchResult =
  | { status: 'ok'; config: DeptConfig; etag?: string }
  | { status: 'failed'; detail: string; httpStatus?: number };

/** 落实结果。分「改了什么」与「现在是什么」两组。 */
export type ApplyReport = {
  version: string;
  agentsEnabled: string[];
  agentsDisabled: string[];
  assistantsEnabled: string[];
  assistantsDisabled: string[];
  repointed: string[];
  /** 本轮按服务端定义新建的助手（issue #7 的 import 路径）。 */
  imported: string[];
  /** 本轮被钉了默认模型的助手（issue #6）。 */
  modelPinned: string[];
  failures: string[];
  /**
   * 落实后实际处于启用状态的集合（FR-8 回读）。
   *
   * 与上面的动作列表分开，因为它们回答不同问题：重放是幂等的，第二次跑动作列表
   * 会是空的——空不代表没生效。服务端要比对的是这个。
   */
  finalAgents: string[];
  finalAssistants: string[];
};

/** 两阶段状态（FR-2c）。 */
export type ApplyState = { phase: 'applying' | 'applied' | 'corrupt'; version: string; at: number };
