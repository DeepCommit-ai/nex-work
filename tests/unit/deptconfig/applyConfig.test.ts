import { describe, expect, it } from 'vitest';
import { buildReport, planWrites, validateConfig, type CurrentState } from '@/common/deptconfig/applyConfig';
import type { DeptConfig } from '@/common/deptconfig/types';

const cfg = (over: Partial<DeptConfig> = {}): DeptConfig => ({
  version: 'v1',
  dept: 'finance',
  agents: ['claude', 'aionrs'],
  assistants: [{ id: 'word', agent_id: 'claude' }, { id: 'butler' }],
  model_aliases: [],
  gateway: { base_url: 'http://gw:54000', api_key: 'sk-gw-dept', config_dir: '~/.nexwork-claude' },
  ...over,
});

const world = (): CurrentState => ({
  agents: [
    { id: 'claude', enabled: false },
    { id: 'aionrs', enabled: true },
    { id: 'codex', enabled: true },
  ],
  assistants: [
    { id: 'word', enabled: false, agent_id: 'aionrs' },
    { id: 'butler', enabled: true, agent_id: 'aionrs' },
    { id: 'bare:codex', enabled: true },
  ],
});

describe('validateConfig', () => {
  it('rejects an empty agent list rather than disabling everything', () => {
    // 清单是全集，空全集意味着停用一切。服务端已经验过，但反序列化默认值、
    // 缓存损坏、拿到一份旧的空响应，都会把"缺字段"变成"显式的空全集"。
    expect(validateConfig(cfg({ agents: [] }))).toContainEqual(expect.stringContaining('无法发出任何消息'));
  });

  it('rejects a config where nothing is pinned to a collectable agent', () => {
    // FR-3b。21 个 builtin 助手默认全绑 aionrs，其流量没有 acp_session 行，
    // 语料无法归因——而这种配置会正常工作、正常计费、正常回答。
    expect(validateConfig(cfg({ assistants: [{ id: 'butler' }] }))).toContainEqual(expect.stringContaining('无法归因'));
  });

  it('rejects pinning to an agent that will be disabled', () => {
    expect(validateConfig(cfg({ agents: ['aionrs'] }))).toContainEqual(expect.stringContaining('报错卡片'));
  });

  it('accepts a well-formed config', () => {
    expect(validateConfig(cfg())).toEqual([]);
  });

  it('rejects a config without usable gateway credentials', () => {
    // 半份网关配置（有地址没 token）会让流量绕过网关或每次 401，且两种失败
    // 此刻都表现成"配置成功"。
    expect(validateConfig(cfg({ gateway: undefined }))).toContainEqual(expect.stringContaining('不经网关'));
    expect(validateConfig(cfg({ gateway: { base_url: 'http://gw', api_key: '' } }))).toContainEqual(expect.stringContaining('不经网关'));
  });
});

describe('planWrites', () => {
  it('enables everything wanted before disabling anything', () => {
    // 反过来的话，崩在中间会留下"全都停了、还没启用"——员工一个助手都没有。
    // 现在的顺序保证最坏情况仍然可用。
    const w = planWrites(cfg(), world());
    const lastEnable = w.map((x) => x.kind).lastIndexOf('assistant.enable');
    const firstDisable = w.findIndex((x) => x.kind.endsWith('.disable'));
    expect(lastEnable).toBeLessThan(firstDisable);
  });

  it('disables agents last of all', () => {
    // 助手还绑着它时先停 agent，界面上会出现"该助手的 agent 不可用"的报错卡片，
    // 而且粘住不动——正是这个产品要消除的画面。
    const kinds = planWrites(cfg(), world()).map((x) => x.kind);
    const lastAgentDisable = kinds.lastIndexOf('agent.disable');
    const lastAssistantWrite = Math.max(
      kinds.lastIndexOf('assistant.enable'),
      kinds.lastIndexOf('assistant.disable'),
      kinds.lastIndexOf('assistant.repoint')
    );
    expect(lastAgentDisable).toBeGreaterThan(lastAssistantWrite);
  });

  it('repoints an assistant that points at the wrong agent', () => {
    expect(planWrites(cfg(), world())).toContainEqual({
      kind: 'assistant.repoint',
      id: 'word',
      agentId: 'claude',
    });
  });

  it('plans nothing on a second run — replay is idempotent', () => {
    // 全量重放每次启动都跑。无条件写会白白刷新 updated_at 并扩大失败面。
    const after: CurrentState = {
      agents: [
        { id: 'claude', enabled: true },
        { id: 'aionrs', enabled: true },
        { id: 'codex', enabled: false },
      ],
      assistants: [
        { id: 'word', enabled: true, agent_id: 'claude' },
        { id: 'butler', enabled: true, agent_id: 'aionrs' },
        { id: 'bare:codex', enabled: false },
      ],
    };
    expect(planWrites(cfg(), after)).toEqual([]);
  });

  it('does not disable an assistant that is already disabled', () => {
    const w = planWrites(cfg(), {
      ...world(),
      assistants: [...world().assistants.slice(0, 2), { id: 'bare:codex', enabled: false }],
    });
    expect(w.filter((x) => x.kind === 'assistant.disable')).toEqual([]);
  });
});

describe('buildReport', () => {
  it('reports the final state, not the actions', () => {
    // 重放是幂等的：第二次跑动作列表是空的，空不代表没生效。服务端用动作列表
    // 去比对会把"没有变化"读成"什么都没生效"。
    const after: CurrentState = {
      agents: [
        { id: 'claude', enabled: true },
        { id: 'codex', enabled: false },
      ],
      assistants: [
        { id: 'word', enabled: true },
        { id: 'bare:codex', enabled: false },
      ],
    };
    const rep = buildReport('v1', [], after, []);
    expect(rep.assistantsEnabled).toEqual([]);
    expect(rep.finalAssistants).toEqual(['word']);
    expect(rep.finalAgents).toEqual(['claude']);
  });

  it('carries failures through so partial success is visible', () => {
    const rep = buildReport('v1', [], { agents: [], assistants: [] }, ['启用 word 失败']);
    expect(rep.failures).toHaveLength(1);
  });
});
