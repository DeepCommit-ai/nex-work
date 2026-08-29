/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * [ENTERPRISE PATCH] 部门技能写盘桥的桌面通道 —— cynapse issue #16。
 *
 * webui 形态的写盘桥挂在 web-host static-server 的 `/host-api/dept-skills/*`；
 * 桌面形态 renderer 的 HTTP 面直连 aioncore、根本不经过 static-server，所以
 * 主进程在这里注册等价的 IPC provider。**不复制任何守卫逻辑**：直接调 web-host
 * `dept-skills.ts` 的同一份核心（`handleDeptSkillsIpcCall`），白名单、resolve
 * 前缀、幂等比对、错误码与 HTTP 桥逐字节相同。
 *
 * dataDir 用 `getDataPath()`——与本进程把 aioncore 拉起来时传的 dbPath /
 * 内嵌 WebUI 启动时传给写盘桥的 dataDir 同源（src/index.ts、webuiConfig.ts），
 * `<dataDir>/builtin-skills/` 就是 aioncore 每会话物化技能的那棵子树。
 * managedConfigDir 不传 = 核心默认 `~/.nexwork-claude`，与 HTTP 桥一致。
 *
 * handler 绝不 throw（handleDeptSkillsIpcCall 内部已收敛成失败信封）：bridge
 * 的 invoke 对 throw 的 provider 永远不回包，renderer 会挂死在 pending。
 */

import { ipcBridge } from '@/common';
import { handleDeptSkillsIpcCall } from '@aionui/web-host';
import { getDataPath } from '@process/utils';

export function initDeptSkillsBridge(): void {
  ipcBridge.deptSkills.call.provider((payload) => handleDeptSkillsIpcCall(payload, { dataDir: getDataPath() }));
}
