/**
 * [ENTERPRISE PATCH] 技能写盘通道选择的测试 —— cynapse issue #16。
 *
 * 三件"必须测出来"的性质：
 * - **选道正确**：桌面走 IPC 且绝不碰 fetch；webui 走 HTTP 且绝不碰 IPC——
 *   选错通道的表现是"落实卡死/静默失败"，不是报错；
 * - **失败面同构**：同一份失败信封经两通道抛出的 Error 逐字符相同，
 *   落实报告(failures)在两形态语义一致；
 * - **IPC 无应答不挂死**：bridge 的 invoke 对未注册 handler 永远 pending，
 *   超时必须把它变成如实失败——静默 pending 等于"少两个技能"却显示配置成功。
 */
import { describe, expect, it, vi } from 'vitest';
import { callDeptSkills, type DeptSkillsChannelDeps } from '@/common/deptconfig/skillsChannel';

const okEnvelope = { success: true, data: { changed: true } };
const failEnvelope = { success: false, error: '技能名只允许小写字母/数字/连字符，≤64 字符', code: 'BAD_SKILL_NAME' };

const httpRes = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

const deps = (over: Partial<DeptSkillsChannelDeps>): DeptSkillsChannelDeps => ({
  isDesktop: () => false,
  invokeIpc: vi.fn(() => Promise.resolve(okEnvelope)),
  ...over,
});

describe('通道选择', () => {
  it('桌面走 IPC、载荷原样传递、绝不碰 fetch', async () => {
    const invokeIpc = vi.fn(() => Promise.resolve(okEnvelope));
    const fetchFn = vi.fn();
    await callDeptSkills(
      'write',
      { name: 'delivery-parser', content: '# 薄壳\n' },
      deps({ isDesktop: () => true, invokeIpc, fetchFn: fetchFn as never })
    );
    expect(invokeIpc).toHaveBeenCalledWith({ action: 'write', name: 'delivery-parser', content: '# 薄壳\n' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('桌面 retire 载荷不带 content 键（IPC 侧核心按 unknown 校验，不该收到多余键）', async () => {
    const invokeIpc = vi.fn(() => Promise.resolve({ success: true, data: { removed: true } }));
    await callDeptSkills('retire', { name: 'old-skill' }, deps({ isDesktop: () => true, invokeIpc }));
    expect(invokeIpc).toHaveBeenCalledWith({ action: 'retire', name: 'old-skill' });
  });

  it('webui 走 HTTP /host-api/dept-skills/<action>、绝不碰 IPC', async () => {
    const invokeIpc = vi.fn();
    const fetchFn = vi.fn(() => Promise.resolve(httpRes(200, okEnvelope)));
    await callDeptSkills(
      'write',
      { name: 'delivery-parser', content: '# 薄壳\n' },
      deps({ invokeIpc, fetchFn: fetchFn as never })
    );
    expect(fetchFn).toHaveBeenCalledWith('/host-api/dept-skills/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'delivery-parser', content: '# 薄壳\n' }),
    });
    expect(invokeIpc).not.toHaveBeenCalled();
  });
});

describe('桌面 IPC 失败面', () => {
  it('失败信封 → throw `${code}：${error}`', async () => {
    await expect(
      callDeptSkills(
        'write',
        { name: 'x', content: 'x' },
        deps({ isDesktop: () => true, invokeIpc: () => Promise.resolve(failEnvelope) })
      )
    ).rejects.toThrow('BAD_SKILL_NAME：技能名只允许小写字母/数字/连字符，≤64 字符');
  });

  it('信封形状损坏（null / 空对象）→ 兜底成可指认的失败，不 crash 不静默', async () => {
    for (const bad of [null, {}, '不是信封']) {
      await expect(
        callDeptSkills(
          'write',
          { name: 'x-skill', content: 'x' },
          deps({ isDesktop: () => true, invokeIpc: () => Promise.resolve(bad) })
        ),
        `payload=${JSON.stringify(bad)}`
      ).rejects.toThrow(/IPC：写盘桥调用失败/);
    }
  });

  it('handler 无应答 → 超时如实失败（bridge 的 invoke 会永远 pending，必须有人收尸）', async () => {
    await expect(
      callDeptSkills(
        'write',
        { name: 'x-skill', content: 'x' },
        deps({ isDesktop: () => true, invokeIpc: () => new Promise(() => {}), ipcTimeoutMs: 20 })
      )
    ).rejects.toThrow(/IPC_UNREACHABLE：主进程技能写盘通道 20ms 无应答/);
  });
});

describe('webui HTTP 失败面', () => {
  it('!ok + 失败信封 → `${code}：${error}`', async () => {
    await expect(
      callDeptSkills(
        'write',
        { name: 'x', content: 'x' },
        deps({ fetchFn: (() => Promise.resolve(httpRes(400, failEnvelope))) as never })
      )
    ).rejects.toThrow('BAD_SKILL_NAME：技能名只允许小写字母/数字/连字符，≤64 字符');
  });

  it('非 JSON 响应 → 按状态码兜底', async () => {
    const fetchFn = () =>
      Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('bad json')) });
    await expect(callDeptSkills('retire', { name: 'x-skill' }, deps({ fetchFn: fetchFn as never }))).rejects.toThrow(
      '502：写盘桥调用失败'
    );
  });

  it('parity：同一失败信封经两通道抛出的 Error message 逐字符相同', async () => {
    const viaIpc = await callDeptSkills(
      'write',
      { name: 'x', content: 'x' },
      deps({ isDesktop: () => true, invokeIpc: () => Promise.resolve(failEnvelope) })
    ).catch((e: Error) => e.message);
    const viaHttp = await callDeptSkills(
      'write',
      { name: 'x', content: 'x' },
      deps({ fetchFn: (() => Promise.resolve(httpRes(400, failEnvelope))) as never })
    ).catch((e: Error) => e.message);
    expect(viaIpc).toBe(viaHttp);
  });
});
