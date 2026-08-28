/**
 * [ENTERPRISE PATCH] 受管 Claude Code —— cynapse issue #8。
 *
 * ## 为什么存在
 *
 * aioncore 对 Claude Code 的默认启动是 `binary_name: "claude"` → PATH 解析，
 * 也就是**员工自己装的 claude**：版本随员工自己升级漂移、卸载即断、行为不可控。
 * 企业交付要求相反的三件事：随本软件安装、版本由我们钉死、与员工个人环境隔离。
 *
 * ## 机制
 *
 * 安装包捆绑 pinned 的官方原生二进制（npm 平台包 `@anthropic-ai/claude-code-
 * <plat>-<arch>` 里的 `package/claude`，构建时由 scripts/prepareClaude.js 取好，
 * 运行时零下载）。布局与 `bundled-aioncore/` 同级同构：
 *
 *     bundled-claude/<plat>-<arch>/claude      ← 仓库 / web-cli 包 / electron 三形态一致
 *
 * 后端就绪后 `PUT /api/agents/2d23ff1c/overrides` 把 `command_override` 钉到这个
 * 绝对路径。通道实测存在（aioncore `agent_metadata.command` 列），优先于 PATH。
 * 每次启动重钉——应用挪位置/升版本自愈。
 *
 * ⚠️ aioncore 的 overrides PUT 是**整体替换**（实测：漏掉 env_override 会把网关
 * 四件套清空，反之漏掉 command_override 会把钉子清掉）。所以这里 GET 后原样带回
 * env_override；所有其他 setAgentOverrides 写者也必须带回 command_override。
 *
 * ## 失败姿态
 *
 * 找不到捆绑载荷（开发库没跑 prepareClaude）→ 打日志、跳过，回落 PATH 行为。
 * 这里绝不 throw：Claude 启动来源的治理问题不能挡整个后端启动（与本仓一贯的
 * "可用性失败开放"一致），但每种跳过都必须响——静默回落等于没修。
 *
 * 逃生阀：`AIONUI_MANAGED_CLAUDE=0` 整体停用；`AIONUI_CLAUDE_BIN` 直接指定二进制。
 */

import fs from 'fs';
import path from 'path';

export const CLAUDE_AGENT_ID = '2d23ff1c';

/** 从 aioncore 二进制路径推导捆绑 claude：`<bin目录>/../../bundled-claude/<plat>-<arch>/claude`。 */
export function deriveClaudeBinaryPath(
  aioncoreBinaryPath: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string {
  const exe = platform === 'win32' ? 'claude.exe' : 'claude';
  return path.resolve(path.dirname(aioncoreBinaryPath), '..', '..', 'bundled-claude', `${platform}-${arch}`, exe);
}

export type ProvisionManagedClaudeOptions = {
  aioncoreBinaryPath: string;
  backendPort: number;
  /** 测试注入。 */
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
};

/**
 * 后端就绪后调用。永不 throw；每个分支都出一行日志。
 * 幂等：command_override 已是目标路径则不写。
 */
export async function provisionManagedClaude(opts: ProvisionManagedClaudeOptions): Promise<void> {
  const log = (msg: string) => console.info(`[managed-claude] ${msg}`);
  const warn = (msg: string, e?: unknown) => console.warn(`[managed-claude] ${msg}`, e ?? '');
  try {
    if (process.env.AIONUI_MANAGED_CLAUDE === '0') {
      log('AIONUI_MANAGED_CLAUDE=0——停用，Claude Code 回落 PATH 解析');
      return;
    }
    const claudeBin =
      process.env.AIONUI_CLAUDE_BIN?.trim() ||
      deriveClaudeBinaryPath(opts.aioncoreBinaryPath, opts.platform, opts.arch);
    if (!fs.existsSync(claudeBin)) {
      log(
        `没有捆绑载荷（${claudeBin} 不存在）——跳过，Claude Code 回落 PATH 解析。发布构建必须先跑 scripts/prepareClaude.js`
      );
      return;
    }

    const doFetch = opts.fetchImpl ?? fetch;
    const base = `http://127.0.0.1:${opts.backendPort}`;
    // 就绪信号到 API 可用之间可能有毫秒级窗口，给两次重试。
    let overrides: { command_override?: string | null; env_override?: { name: string; value: string }[] } | undefined;
    for (let i = 0; i < 3; i += 1) {
      try {
        const res = await doFetch(`${base}/api/agents/${CLAUDE_AGENT_ID}/overrides`);
        if (res.ok) {
          overrides = ((await res.json()) as { data?: typeof overrides }).data ?? {};
          break;
        }
      } catch {
        /* 重试 */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!overrides) {
      warn('读不到 Claude Code 的 overrides——本次不钉，下次启动再试');
      return;
    }
    if (overrides.command_override === claudeBin) {
      log(`已钉在 ${claudeBin}（无变化）`);
      return;
    }
    const put = await doFetch(`${base}/api/agents/${CLAUDE_AGENT_ID}/overrides`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      // 整体替换语义：env_override 必须原样带回，否则网关四件套被清空。
      body: JSON.stringify({ command_override: claudeBin, env_override: overrides.env_override ?? [] }),
    });
    if (!put.ok) {
      warn(`钉 command_override 失败：HTTP ${put.status}`);
      return;
    }
    log(`Claude Code 已钉到捆绑二进制：${claudeBin}`);
  } catch (e) {
    warn('提供受管 Claude 时出错（不影响后端启动）', e);
  }
}
