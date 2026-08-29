/**
 * [ENTERPRISE PATCH] 技能写盘/退役的通道选择 —— cynapse issue #16。
 *
 * 同一份核心（web-host `dept-skills.ts` 的 performDeptSkillAction）有两个入口：
 *
 * - **webui**：renderer 与 static-server 同源，走 HTTP `/host-api/dept-skills/*`；
 * - **Electron 桌面**：renderer 直连 aioncore、够不到 static-server，走主进程
 *   IPC（`enterprise.dept-skills` provider，见 process/bridge/deptSkillsBridge.ts）。
 *
 * 分叉只存在于本文件：applyConfig 的 PlannedWrite 与 deptConfigService 的
 * executeWrite 两形态零差异。信封同构（{success,data}/{success,error,code}），
 * 失败面也同构——两通道抛出的 Error 都是 `${code}：${error}`。
 *
 * ## 为什么 IPC 要超时兜底
 *
 * bridge 的 invoke 没有握手：handler 未注册（旧版主进程、初始化顺序错）时
 * 请求发出去无人应答，promise **永远 pending**——落实流程会无声卡死在第一条
 * skill.write 上，表现成"界面毫无反应"（enterpriseStore 注释里踩过的同一坑）。
 * 超时后如实 throw 进 failures，绝不静默跳过："少两个技能"不能表现成"配置成功"。
 *
 * 依赖全部注入（isDesktop / invokeIpc / fetchFn）：本模块不 import IPC 与 React，
 * 单测不需要 Electron 也不需要网络；绑定在 deptConfigService 里做。
 */

export type DeptSkillsAction = 'write' | 'retire';

export type DeptSkillsCallBody = { name: string; content?: string };

/** 读取侧的宽松信封：坏形状也要能收敛成可指认的失败，不能 crash。 */
type LooseEnvelope = { success?: boolean; error?: string; code?: string } | null | undefined;

type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type DeptSkillsChannelDeps = {
  /** 运行环境判定（renderer 里绑 isElectronDesktop）。 */
  isDesktop: () => boolean;
  /** 桌面 IPC 通道（renderer 里绑 ipcBridge.deptSkills.call.invoke）。 */
  invokeIpc: (payload: { action: DeptSkillsAction; name: string; content?: string }) => Promise<unknown>;
  /** 测试注入；生产默认全局 fetch（webui 同源）。 */
  fetchFn?: FetchLike;
  /** IPC 无应答的兜底时限；默认 15s（写盘是本机同步操作，正常毫秒级返回）。 */
  ipcTimeoutMs?: number;
};

export const DEFAULT_IPC_TIMEOUT_MS = 15_000;

/** IPC 信封 → 结果：success!==true 一律 throw `${code}：${error}`，与 HTTP 通道同一失败面。 */
const unwrapIpcEnvelope = (payload: LooseEnvelope): void => {
  if (payload?.success !== true) {
    throw new Error(`${payload?.code ?? 'IPC'}：${payload?.error ?? '写盘桥调用失败'}`);
  }
};

/**
 * 调技能写盘/退役桥，按运行环境选通道。成功静默返回；一切失败都 throw
 * （调用方把它记进 failures——部分失败必须可指认，绝不静默）。
 */
export const callDeptSkills = async (
  action: DeptSkillsAction,
  body: DeptSkillsCallBody,
  deps: DeptSkillsChannelDeps
): Promise<void> => {
  if (deps.isDesktop()) {
    const timeoutMs = deps.ipcTimeoutMs ?? DEFAULT_IPC_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const payload = (await Promise.race([
        deps.invokeIpc({ action, name: body.name, ...(body.content !== undefined ? { content: body.content } : {}) }),
        new Promise<never>((_, rejectRace) => {
          timer = setTimeout(
            () =>
              rejectRace(
                new Error(
                  `IPC_UNREACHABLE：主进程技能写盘通道 ${timeoutMs}ms 无应答（主进程未注册 handler 或版本不匹配）`
                )
              ),
            timeoutMs
          );
        }),
      ])) as LooseEnvelope;
      unwrapIpcEnvelope(payload);
      return;
    } finally {
      clearTimeout(timer);
    }
  }

  // webui：同源打 static-server 的受限写盘桥（cynapse issue #14）。
  const fetchFn = deps.fetchFn ?? (fetch as unknown as FetchLike);
  const res = await fetchFn(`/host-api/dept-skills/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let payload: LooseEnvelope = null;
  try {
    payload = (await res.json()) as LooseEnvelope;
  } catch {
    /* 非 JSON：按状态码报 */
  }
  if (!res.ok || payload?.success !== true) {
    // 与 IPC 的失败面同构：`${code}：${error}`；HTTP 独有的兜底是状态码。
    throw new Error(`${payload?.code ?? res.status}：${payload?.error ?? '写盘桥调用失败'}`);
  }
};
