/**
 * [ENTERPRISE PATCH] 部门配置 HTTP 客户端的契约测试。
 *
 * 三类失败（key 无效 / 连不上 / 响应坏了）的处置完全不同，必须可区分；
 * 上报体的字段名是与 cynapse 服务端的双向契约，改一边等于都改。
 */
import { describe, expect, it } from 'vitest';
import { buildProvenanceEnvValue, CYNAPSE_KEY_HEADER, fetchDeptConfig, postReport, toReportBody } from '@/common/deptconfig/client';
import type { ApplyReport } from '@/common/deptconfig/types';

const res = (status: number, body: unknown, etag?: string) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (n: string) => (n === 'ETag' && etag ? etag : null) },
  json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)),
});

describe('fetchDeptConfig', () => {
  it('sends the key in X-Cynapse-Key and returns config with etag', async () => {
    let seen: { url?: string; headers?: Record<string, string> } = {};
    const out = await fetchDeptConfig('http://cy:54001/', 'cyk-abc', (url, init) => {
      seen = { url, headers: init?.headers };
      return Promise.resolve(res(200, { version: 'v1', dept: 'f', agents: [], assistants: [], model_aliases: [] }, '"e1"'));
    });
    expect(seen.url).toBe('http://cy:54001/config'); // 末尾斜杠不产生 //config
    expect(seen.headers?.[CYNAPSE_KEY_HEADER]).toBe('cyk-abc');
    expect(out).toMatchObject({ status: 'ok', etag: '"e1"' });
  });

  it('a 401 is "key 无效"，不是网络问题', async () => {
    const out = await fetchDeptConfig('http://cy', 'bad', () => Promise.resolve(res(401, {})));
    expect(out).toMatchObject({ status: 'failed', httpStatus: 401 });
    expect((out as { detail: string }).detail).toContain('key');
  });

  it('a network failure carries the reason and no fake config', async () => {
    const out = await fetchDeptConfig('http://cy', 'k', () => Promise.reject(new Error('ECONNREFUSED')));
    expect(out.status).toBe('failed');
    expect((out as { detail: string }).detail).toContain('ECONNREFUSED');
  });

  it('a non-JSON 200 is a failure, not an empty config', async () => {
    // 空配置是"显式的空全集"——清单是全集，落实它会停用一切。
    const out = await fetchDeptConfig('http://cy', 'k', () => Promise.resolve(res(200, new Error('bad json'))));
    expect(out.status).toBe('failed');
  });
});

describe('buildProvenanceEnvValue', () => {
  it('is a single "header: json" line the gateway can record', () => {
    const v = buildProvenanceEnvValue({ dept: 'finance', configVersion: 'v3', clientId: 'm-1' });
    const [name, ...rest] = v.split(': ');
    expect(name).toBe('x-litellm-spend-logs-metadata');
    expect(JSON.parse(rest.join(': '))).toEqual({ dept: 'finance', config_version: 'v3', client_id: 'm-1', client: 'nexwork' });
    expect(v).not.toContain('\n'); // ANTHROPIC_CUSTOM_HEADERS 以换行分隔多个头
  });
});

describe('toReportBody', () => {
  it('reports final state under the field names the server compares', () => {
    // 与 cynapse server/apply.py::to_report_body 的双向契约。上报动作集合而非
    // 实际状态的话，幂等重放的第二次会上报空集，服务端读成"全部缺失"。
    const rep: ApplyReport = {
      version: 'v2',
      agentsEnabled: ['a'], agentsDisabled: [], assistantsEnabled: ['w'], assistantsDisabled: [],
      repointed: ['w'], imported: [], modelPinned: [], failures: ['x 失败'],
      finalAgents: ['a', 'b'], finalAssistants: ['w', 'z'],
    };
    expect(toReportBody(rep, 'm-1')).toEqual({
      client_id: 'm-1',
      applied_version: 'v2',
      agents_enabled: ['a', 'b'],
      assistants_enabled: ['w', 'z'],
      failures: ['x 失败'],
    });
  });
});

describe('postReport', () => {
  it('returns drift from the server verbatim', async () => {
    const out = await postReport('http://cy', 'k', {}, () => Promise.resolve(res(200, { ok: false, drift: ['版本不一致'] })));
    expect(out).toEqual({ ok: false, drift: ['版本不一致'] });
  });

  it('a failed post reports itself instead of pretending consistency', async () => {
    const out = await postReport('http://cy', 'k', {}, () => Promise.reject(new Error('down')));
    expect(out.ok).toBe(false);
    expect(out.detail).toContain('down');
  });
});
