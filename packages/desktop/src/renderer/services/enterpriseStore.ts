/**
 * [ENTERPRISE PATCH] 企业接入配置的持久化。
 *
 * 走 `/api/settings/client` 的 KV，**不用 ConfigStorage**：后者用 in-process
 * bridge，其 provider handler 只在 desktop 主进程里注册；web 模式的 renderer 里
 * 没有那个 handler，`invoke` 发出去无人应答，promise 永远 pending——落实会静默
 * 卡死在"存 applyState"这一步，界面毫无反应（实测 2026-08-27）。
 *
 * `/api/settings/client` 是 desktop 与 web 都接的 HTTP KV（语言、字体等设置都走它）。
 */

import { httpRequest } from '@/common/adapter/httpBridge';

export type EnterpriseApplyState = { phase: 'applying' | 'applied'; version: string; at: number };

const get = async <T>(key: string): Promise<T | undefined> => {
  const data = await httpRequest<Record<string, T | undefined>>('GET', `/api/settings/client?keys=${encodeURIComponent(key)}`);
  return data?.[key];
};
const set = async (key: string, value: unknown): Promise<void> => {
  await httpRequest<void>('PUT', '/api/settings/client', { [key]: value });
};

export const enterpriseStore = {
  getServerUrl: () => get<string>('enterprise.serverUrl'),
  getDeptKey: () => get<string>('enterprise.deptKey'),
  getApplyState: () => get<EnterpriseApplyState>('enterprise.applyState'),
  setServerUrl: (v: string) => set('enterprise.serverUrl', v),
  setDeptKey: (v: string) => set('enterprise.deptKey', v),
  setApplyState: (v: EnterpriseApplyState) => set('enterprise.applyState', v),
  async getClientId(): Promise<string> {
    const existing = await get<string>('enterprise.clientId');
    if (existing) return existing;
    const id = crypto.randomUUID();
    await set('enterprise.clientId', id);
    return id;
  },
};
