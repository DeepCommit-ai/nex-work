import { describe, expect, it } from 'vitest';
import {
  filterManagedAssistants,
  isManagedAssistant,
  prepareManagedConversation,
  setManagedCatalogIds,
} from '@/common/deptconfig/managedConversation';

describe('published assistant identities', () => {
  it('restores server localization even when native user records have no localized fields', () => {
    setManagedCatalogIds(['office-assistant'], {
      'office-assistant': { name_i18n: { 'zh-CN': '办公助手' }, description_i18n: { 'zh-CN': '处理办公文件' } },
    });
    const list = filterManagedAssistants([
      { id: 'office-assistant', name_i18n: {} },
      { id: 'legacy', name_i18n: {} },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].name_i18n).toEqual({ 'zh-CN': '办公助手' });
    expect(isManagedAssistant('default-assistant')).toBe(true);
  });
  it('replaces stale form overrides with the installed skills and MCP transports only for new conversations', async () => {
    setManagedCatalogIds(['office-assistant']);
    const body = {
      assistant: {
        id: 'office-assistant',
        conversation_overrides: { skill_ids: ['old-skill'], mcp_ids: ['old-mcp'], permission: 'default' },
      },
      extra: { workspace: '/employee/files' },
    };
    const read = async <T>(route: string): Promise<T> =>
      (route === '/api/mcp/servers'
        ? [{ id: 'current-mcp', name: 'Tool', enabled: true, transport: { type: 'http', url: 'http://local.test' } }]
        : {
            capabilities: { default_skill_ids: ['current-skill'] },
            defaults: { mcps: { value: ['current-mcp'] }, model: { mode: 'auto' } },
          }) as T;
    expect(await prepareManagedConversation('POST', '/api/conversations', body, read)).toMatchObject({
      assistant: {
        conversation_overrides: { skill_ids: ['current-skill'], mcp_ids: ['current-mcp'], permission: 'default' },
      },
      extra: { workspace: '/employee/files', selected_session_mcp_servers: [{ id: 'current-mcp' }] },
    });
    expect(await prepareManagedConversation('POST', '/api/conversations/old/messages', body, read)).toBe(body);
  });
});
