/**
 * [ENTERPRISE PATCH] agent 显示名的唯一出口 —— cynapse issue #9。
 *
 * builtin agent 在 aioncore 里没有改名 API(实测 PUT/PATCH /api/agents/{id}
 * 均 404;服务器实例只能手改数据库,员工机器连这条路都没有)。所以"清单里保留
 * 的 agent 行名还是 Claude Code"这个泄漏没法在数据层修,只能在显示层收口:
 *
 *   1. 服务端下发名(/config 的 agent_names → policy.agentNames)——企业改名的
 *      正式通道,按部门可配;
 *   2. 没下发且 cli.visible=false——中性兜底,未接入/接入前的机器也不漏 vendor 名;
 *   3. 其余(开源形态)——本地原名,行为与上游一致。
 *
 * 所有渲染 agent 名字的地方必须经过这里。直接读 agent.name 的代码就是下一个泄漏点。
 */

import { can, getPolicy } from '@/common/capabilities/policy';

type TranslateFn = (key: string, options?: { defaultValue?: string }) => string;

export const resolveAgentDisplayName = (
  agentId: string | undefined,
  localName: string | undefined,
  t?: TranslateFn
): string => {
  const fallback = localName ?? '';
  try {
    if (agentId) {
      const served = getPolicy().agentNames?.[agentId];
      if (served) return served;
    }
    if (!can('cli.visible')) {
      return t ? t('agent.neutralEngineName', { defaultValue: '智能引擎' }) : '智能引擎';
    }
  } catch {
    /* policy 不可用时回落本地名——显示问题绝不能变成白屏 */
  }
  return fallback;
};
