/**
 * 部门技能写盘桥的测试（cynapse issue #14）。
 *
 * 重点是两件"必须测出来"的性质：
 * - **幂等**：全量重放每次启动都跑，同内容第二次写必须 no-op；
 * - **越权拒绝**：技能名是唯一的路径输入，带 `/`、`..`、大写的名字必须被拒，
 *   且盘上不得出现任何产物——"拒绝了但已经写了一半"不算拒绝。
 *
 * 用真 http server + fetch 而不是 mock req/res：readBody 的流式读取、
 * writeHead/end 的时序都是被测行为。
 */

import fs from 'fs';
import http from 'node:http';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  handleDeptSkillsRequest,
  isValidSkillName,
  resolveRetireDir,
  resolveSkillFile,
  type DeptSkillsContext,
} from './dept-skills.js';

let server: http.Server;
let base: string;
let dataDir: string;
let managedConfigDir: string;
let handled: boolean[];

const listen = (ctx: () => DeptSkillsContext): Promise<void> =>
  new Promise((resolve) => {
    server = http.createServer(async (req, res) => {
      const hit = await handleDeptSkillsRequest(req, res, ctx());
      handled.push(hit);
      if (!hit) {
        res.writeHead(418).end(); // 未命中走"别的分支"——测试里用状态码区分
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

const post = (p: string, body: unknown): Promise<Response> =>
  fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dept-skills-data-'));
  managedConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dept-skills-managed-'));
  handled = [];
  await listen(() => ({ dataDir, managedConfigDir }));
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(managedConfigDir, { recursive: true, force: true });
});

describe('isValidSkillName', () => {
  it('accepts the real skill names and rejects every path-shaped impostor', () => {
    expect(isValidSkillName('delivery-parser')).toBe(true);
    expect(isValidSkillName('oa-form-filler')).toBe(true);
    for (const bad of ['../escape', 'a/b', 'a\\b', 'UPPER', '', ' ', '.hidden', '..', 'a'.repeat(65), 42, null]) {
      expect(isValidSkillName(bad as never), `${JSON.stringify(bad)} 竟被放行`).toBe(false);
    }
  });
});

describe('resolveSkillFile / resolveRetireDir', () => {
  it('resolves inside the allowed subtree only', () => {
    expect(resolveSkillFile('/data', 'good-skill')).toBe(path.resolve('/data/builtin-skills/good-skill/SKILL.md'));
    expect(resolveSkillFile('/data', '../oops')).toBeNull();
    expect(resolveRetireDir('/cfg', 'good-skill')).toBe(path.resolve('/cfg/skills/good-skill'));
    expect(resolveRetireDir('/cfg', 'a/b')).toBeNull();
  });
});

describe('write', () => {
  it('creates the directory and writes SKILL.md (aioncore 的 /api/fs/write 建不了目录——这正是本桥存在的原因)', async () => {
    const r = await post('/host-api/dept-skills/write', { name: 'new-skill', content: '# 薄壳\n' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ success: true, data: { changed: true } });
    expect(fs.readFileSync(path.join(dataDir, 'builtin-skills', 'new-skill', 'SKILL.md'), 'utf8')).toBe('# 薄壳\n');
  });

  it('is idempotent: same content twice → second write is a no-op that does not touch the file', async () => {
    await post('/host-api/dept-skills/write', { name: 'idem-skill', content: '# v1\n' });
    const file = path.join(dataDir, 'builtin-skills', 'idem-skill', 'SKILL.md');
    const before = fs.statSync(file).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    const r2 = await post('/host-api/dept-skills/write', { name: 'idem-skill', content: '# v1\n' });
    expect(await r2.json()).toEqual({ success: true, data: { changed: false } });
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });

  it('overwrites when the content actually changed', async () => {
    await post('/host-api/dept-skills/write', { name: 'up-skill', content: '# v1\n' });
    const r = await post('/host-api/dept-skills/write', { name: 'up-skill', content: '# v2\n' });
    expect(await r.json()).toEqual({ success: true, data: { changed: true } });
    expect(fs.readFileSync(path.join(dataDir, 'builtin-skills', 'up-skill', 'SKILL.md'), 'utf8')).toBe('# v2\n');
  });

  it('rejects path-shaped names and leaves the disk untouched', async () => {
    for (const bad of ['../escape', 'a/b', 'UPPER', '..', '']) {
      const r = await post('/host-api/dept-skills/write', { name: bad, content: 'x' });
      expect(r.status, `name=${JSON.stringify(bad)}`).toBe(400);
      const j = (await r.json()) as { success: boolean; code: string };
      expect(j.success).toBe(false);
      expect(j.code).toBe('BAD_SKILL_NAME');
    }
    // dataDir 之外、之内都不得有任何写入产物
    expect(fs.readdirSync(dataDir)).toEqual([]);
    expect(fs.existsSync(path.join(dataDir, '..', 'escape'))).toBe(false);
  });

  it('rejects a missing/blank content — 空 SKILL.md 是"看起来配了"的静默失败', async () => {
    for (const content of [undefined, '', '   \n', 42]) {
      const r = await post('/host-api/dept-skills/write', { name: 'blank-skill', content });
      expect(r.status).toBe(400);
      expect(((await r.json()) as { code: string }).code).toBe('BAD_CONTENT');
    }
    expect(fs.existsSync(path.join(dataDir, 'builtin-skills', 'blank-skill'))).toBe(false);
  });

  it('answers 503 instead of guessing when dataDir is not configured', async () => {
    await new Promise((r) => server.close(r));
    await listen(() => ({ managedConfigDir }));
    const r = await post('/host-api/dept-skills/write', { name: 'x-skill', content: 'x' });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { code: string }).code).toBe('HOST_DATA_DIR_UNAVAILABLE');
  });
});

describe('retire', () => {
  it('removes the managed skill dir once, then reports removed:false — 幂等', async () => {
    const dir = path.join(managedConfigDir, 'skills', 'old-skill');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), 'legacy');
    const r1 = await post('/host-api/dept-skills/retire', { name: 'old-skill' });
    expect(await r1.json()).toEqual({ success: true, data: { removed: true } });
    expect(fs.existsSync(dir)).toBe(false);
    const r2 = await post('/host-api/dept-skills/retire', { name: 'old-skill' });
    expect(await r2.json()).toEqual({ success: true, data: { removed: false } });
  });

  it('refuses to delete outside the managed skills subtree', async () => {
    // 同级诱饵目录：一次成功的越权会把它删掉
    const decoy = path.join(managedConfigDir, 'decoy');
    fs.mkdirSync(decoy, { recursive: true });
    for (const bad of ['../decoy', '..', 'a/b']) {
      const r = await post('/host-api/dept-skills/retire', { name: bad });
      expect(r.status, `name=${JSON.stringify(bad)}`).toBe(400);
    }
    expect(fs.existsSync(decoy)).toBe(true);
  });
});

describe('routing', () => {
  it('ignores non-matching paths so the static/proxy branches still run', async () => {
    const r = await fetch(`${base}/api/anything`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(418); // 落到测试服务器的"别的分支"
    expect(handled.at(-1)).toBe(false);
  });

  it('rejects non-POST on matching paths', async () => {
    const r = await fetch(`${base}/host-api/dept-skills/write`);
    expect(r.status).toBe(405);
  });

  it('rejects an unknown action', async () => {
    const r = await post('/host-api/dept-skills/format-disk', { name: 'x-skill' });
    expect(r.status).toBe(404);
  });

  it('rejects a non-JSON body', async () => {
    const r = await fetch(`${base}/host-api/dept-skills/write`, { method: 'POST', body: '不是 json' });
    expect(r.status).toBe(400);
  });
});
