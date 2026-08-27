/**
 * [ENTERPRISE PATCH] 部门配置落实 —— 编排层。
 *
 * Spec: cynapse `doc/spec/2026-08-27-服务端控制agent-design.md`（FR-2、FR-2b、FR-2c、FR-8）
 *
 * 纯逻辑在 `common/deptconfig/`（可测）；这里只做编排：拉取 → 校验 → 两阶段状态 →
 * 按既定顺序写 → 网关 env + provenance → 回读上报 → 喂 policy store。
 *
 * ## 失败姿态
 *
 * - 拉取/校验失败：**什么都不动**。一份坏配置被如实落实的表现是"配置成功"。
 * - 单条写失败：继续写完其余，失败进 failures——部分成功必须报出是哪部分，
 *   all-or-nothing 会把"有些已经指向网关"藏起来。
 * - 上报失败：不阻塞使用，但结果里带回 detail，不静默。
 */

import { acpConversation, assistants as assistantsBridge, mode } from '@/common/adapter/ipcBridge';
import { normalizePolicy, setPolicy } from '@/common/capabilities/policy';
import { enterpriseStore } from './enterpriseStore';
import { buildReport, planWrites, validateConfig, type CurrentState, type PlannedWrite } from '@/common/deptconfig/applyConfig';
import { buildProvenanceEnvValue, fetchDeptConfig, postReport, toReportBody } from '@/common/deptconfig/client';
import type { ApplyReport, DeptConfig } from '@/common/deptconfig/types';
import { buildEnvOverride } from '@/common/gateway/provisionGateway';
import type { EnvEntry } from '@/common/gateway/types';

/** aionrs 走 provider 行而非 env——与 006 的网关页共用同一行，避免两处各插一条。 */
const GATEWAY_PROVIDER_NAME = 'NexWork Gateway';

export type ApplyOutcome =
  | { status: 'failed'; detail: string }
  | {
      status: 'applied';
      report: ApplyReport;
      /** 服务端比对回读后报告的漂移；空数组 = 两边一致。 */
      drift: string[];
      /** 上报本身的失败（网络等）。有值时 drift 不可信。 */
      reportDetail?: string;
    };

const readCurrentState = async (): Promise<{ state: CurrentState; agentTypes: Map<string, string> }> => {
  const agents = (await acpConversation.getManagedAgents.invoke()) ?? [];
  const assistants = (await assistantsBridge.list.invoke()) ?? [];
  return {
    state: {
      agents: agents.map((a) => ({ id: a.id, enabled: a.enabled })),
      assistants: assistants.map((a) => ({ id: a.id, enabled: a.enabled, agent_id: a.agent_id })),
    },
    agentTypes: new Map(agents.map((a) => [a.id, a.agent_type])),
  };
};

const executeWrite = (w: PlannedWrite): Promise<unknown> => {
  switch (w.kind) {
    case 'agent.enable':
      return acpConversation.setAgentEnabled.invoke({ id: w.id, enabled: true });
    case 'agent.disable':
      return acpConversation.setAgentEnabled.invoke({ id: w.id, enabled: false });
    case 'assistant.repoint':
      return assistantsBridge.update.invoke({ id: w.id, agent_id: w.agentId });
    case 'assistant.enable':
      return assistantsBridge.setState.invoke({ id: w.id, enabled: true });
    case 'assistant.disable':
      return assistantsBridge.setState.invoke({ id: w.id, enabled: false });
  }
};

/**
 * 给清单内的 agent 落网关 env（BASE_URL / AUTH_TOKEN / CONFIG_DIR / 自定义头）。
 *
 * aionrs 例外：它读 provider 行。行内 models 用服务端下发的别名——网关页靠探测
 * 拿模型列表，这里不必：别名就是服务端的答案，探测失败不该让 aionrs 断粮。
 */
const provisionGatewayFor = async (cfg: DeptConfig, agentTypes: Map<string, string>, clientId: string, failures: string[]): Promise<void> => {
  const gw = cfg.gateway!;
  const provenance = buildProvenanceEnvValue({ dept: cfg.dept, configVersion: cfg.version, clientId });

  for (const agentId of cfg.agents) {
    const type = agentTypes.get(agentId);
    if (!type) {
      failures.push(`网关下发：agent ${agentId} 不在本机清单里`);
      continue;
    }
    try {
      if (type === 'aionrs') {
        const providers = ((await mode.listProviders.invoke()) as { id: string; name: string }[] | undefined) ?? [];
        const row = providers.find((p) => p.name === GATEWAY_PROVIDER_NAME);
        if (row) {
          await mode.updateProvider.invoke({ id: row.id, platform: 'custom', name: GATEWAY_PROVIDER_NAME, base_url: gw.base_url, api_key: gw.api_key, models: cfg.model_aliases });
        } else {
          await mode.createProvider.invoke({ name: GATEWAY_PROVIDER_NAME, platform: 'custom', base_url: gw.base_url, api_key: gw.api_key, models: cfg.model_aliases });
        }
        continue;
      }
      const overrides = await acpConversation.getAgentOverrides.invoke({ id: agentId });
      const existing: EnvEntry[] = overrides?.env_override ?? [];
      const env = buildEnvOverride(existing, {
        baseUrl: gw.base_url,
        apiKey: gw.api_key,
        configDir: gw.config_dir ?? '',
        customHeadersValue: provenance,
      });
      await acpConversation.setAgentOverrides.invoke({ id: agentId, env_override: env });
    } catch (e) {
      failures.push(`网关下发 ${agentId}：${e instanceof Error ? e.message : String(e)}`);
    }
  }
};

/** 拉取并全量落实。每次启动无条件跑（FR-2b）；重放幂等，无变化时写集合为空。 */
export const applyDeptConfig = async (serverUrl: string, deptKey: string): Promise<ApplyOutcome> => {
  const fetched = await fetchDeptConfig(serverUrl, deptKey);
  if (fetched.status === 'failed') return { status: 'failed', detail: fetched.detail };

  const cfg = fetched.config;
  const problems = validateConfig(cfg);
  if (problems.length) return { status: 'failed', detail: `配置不可落实：${problems.join('；')}` };

  // 凭据确认有效后才持久化——一次敲错的 key 不该覆盖还在用的那份。
  await enterpriseStore.setServerUrl(serverUrl.trim());
  await enterpriseStore.setDeptKey(deptKey);
  const clientId = await enterpriseStore.getClientId();

  // FR-2c 两阶段：先记 applying。中途崩溃时它留在 applying，下次启动的全量重放收尾。
  await enterpriseStore.setApplyState({ phase: 'applying', version: cfg.version, at: Date.now() });

  const failures: string[] = [];
  const { state: before, agentTypes } = await readCurrentState();
  const writes = planWrites(cfg, before);
  console.info('[enterprise] 落实中', { version: cfg.version, dept: cfg.dept, writes: writes.length });
  for (const w of writes) {
    try {
      await executeWrite(w);
    } catch (e) {
      failures.push(`${w.kind} ${w.id}：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await provisionGatewayFor(cfg, agentTypes, clientId, failures);
  if (failures.length) console.warn('[enterprise] 网关下发有失败', failures);

  // 回读实际状态（不是"我们打算设成什么"）→ 上报。
  const { state: after } = await readCurrentState();
  const report = buildReport(cfg.version, writes, after, failures);
  const posted = await postReport(serverUrl, deptKey, toReportBody(report, clientId));
  console.info('[enterprise] 落实完成', { version: cfg.version, drift: posted.drift, reportOk: posted.ok });

  // 002：能力开关喂给 policy store。normalizePolicy 兜住缺键/未知键，坏值只会更收紧。
  setPolicy(normalizePolicy({ version: cfg.version, etag: fetched.etag ?? '', capabilities: cfg.capabilities }, 'remote'));

  if (!failures.length) {
    await enterpriseStore.setApplyState({ phase: 'applied', version: cfg.version, at: Date.now() });
  }
  return { status: 'applied', report, drift: posted.drift, reportDetail: posted.detail };
};

let bootApplyStarted = false;

/**
 * 启动自动重放（FR-2b）。已录入企业接入的机器每次启动全量重放；没录入的什么都不做。
 *
 * 失败不弹窗打断员工——但**必须可观测**：console.error 一条完整的原因，
 * 且 applyState 停在 applying，企业接入页会把它显示出来。
 */
export const autoApplyOnBoot = async (): Promise<void> => {
  if (bootApplyStarted) return;
  bootApplyStarted = true;

  // 读企业接入设置本身要经后端；渲染进程刚加载时后端会话可能还没握手完，首次
  // 读会 fetch 失败。重试几次而不是一次就放弃——否则"配置过的机器重启后没同步"
  // 会静默发生，且看起来和"没配过"一样。
  let serverUrl: string | undefined;
  let deptKey: string | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      [serverUrl, deptKey] = await Promise.all([enterpriseStore.getServerUrl(), enterpriseStore.getDeptKey()]);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!serverUrl || !deptKey) return; // 没录入企业接入，或后端始终读不到——后者下次启动再试

  try {
    const outcome = await applyDeptConfig(serverUrl, deptKey);
    if (outcome.status === 'failed') {
      console.error(`[enterprise] 启动重放失败：${outcome.detail}`);
    } else if (outcome.report.failures.length || outcome.drift.length) {
      console.error('[enterprise] 启动重放有失败或漂移', outcome.report.failures, outcome.drift);
    } else {
      console.info('[enterprise] 启动重放完成', outcome.report.version);
    }
  } catch (e) {
    console.error('[enterprise] 启动重放异常', e);
  }
};
