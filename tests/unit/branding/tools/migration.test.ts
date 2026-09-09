import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateNexworkTools } from '@/branding/tools/migration';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const open = (file: string) => new DatabaseSync(file) as unknown as ISqliteDriver;
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nexwork-tools-'));
  dirs.push(dir);
  const root = path.join(dir, 'nexwork-resources/skills/test');
  mkdirSync(root, { recursive: true });
  const file = path.join(dir, 'aionui-backend.db');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE mcp_servers (id TEXT,user_id TEXT,name TEXT,description TEXT,builtin INTEGER,enabled INTEGER,transport_config TEXT,original_json TEXT,tools TEXT,deleted_at INTEGER);
    INSERT INTO mcp_servers VALUES ('browser','employee','aionui-browser','AionUi browser',1,1,'{"command":"/managed/node","env":{"TOKEN":"keep-private"}}','{"mcpServers":{"aionui-browser":{"command":"/managed/node"}}}','[]',NULL);
    INSERT INTO mcp_servers VALUES ('user','employee','custom-tool','User AionUi quotation',0,0,'{}','{}','[]',NULL);
    CREATE TABLE conversations (id TEXT,extra TEXT);
    INSERT INTO conversations VALUES ('old','{"mcp_server_ids":["browser"],"mcp_servers":["aionui-browser"],"mcp_statuses":[{"id":"browser","name":"aionui-browser","status":"enabled"}],"system_prompt":"user text","skills":["aionui-config"]}');`);
  return { dir, root, file, db };
}
describe('stored tool identity migration', () => {
  it('updates MCP names and old runtime references without changing IDs or private transport', () => {
    const { dir, root, db, file } = fixture();
    db.close();
    migrateNexworkTools(dir, root, open);
    const check = new DatabaseSync(file);
    const server = check.prepare("SELECT id,name,enabled,transport_config FROM mcp_servers WHERE id='browser'").get();
    const extra = JSON.parse(String(check.prepare('SELECT extra FROM conversations').get()?.extra));
    check.close();
    expect(server).toEqual({
      id: 'browser',
      name: 'nexwork-browser',
      enabled: 1,
      transport_config: '{"command":"/managed/node","env":{"TOKEN":"keep-private"}}',
    });
    expect(extra).toMatchObject({
      mcp_server_ids: ['browser'],
      mcp_servers: ['nexwork-browser'],
      mcp_statuses: [{ id: 'browser', name: 'nexwork-browser', status: 'enabled' }],
      skills: ['nexwork-config'],
      system_prompt: 'user text',
    });
    expect(migrateNexworkTools(dir, root, open)).toBe(0);
  });
  it('preserves user-authored MCP metadata', () => {
    const { dir, root, db, file } = fixture();
    const before = db.prepare("SELECT * FROM mcp_servers WHERE id='user'").get();
    db.close();
    migrateNexworkTools(dir, root, open);
    const check = new DatabaseSync(file);
    const after = check.prepare("SELECT * FROM mcp_servers WHERE id='user'").get();
    check.close();
    expect(after).toEqual(before);
  });
  it('fails atomically on a duplicate target MCP name', () => {
    const { dir, root, db, file } = fixture();
    db.exec("INSERT INTO mcp_servers VALUES ('collision','employee','nexwork-browser','user',0,0,'{}','{}','[]',NULL)");
    db.close();
    expect(() => migrateNexworkTools(dir, root, open)).toThrow('collision');
    const check = new DatabaseSync(file);
    const name = check.prepare("SELECT name FROM mcp_servers WHERE id='browser'").get()?.name;
    check.close();
    expect(name).toBe('aionui-browser');
  });
  it('relinks owned skills under their new names while preserving user-modified copies', () => {
    const { dir, root, db } = fixture();
    const old = path.join(dir, 'builtin-skills/auto-inject/aionui-config');
    const next = path.join(root, 'auto-inject/nexwork-config');
    for (const p of [old, next]) {
      mkdirSync(p, { recursive: true });
      writeFileSync(path.join(p, 'SKILL.md'), p === old ? 'old' : 'NexWork');
    }
    const workspace = path.join(dir, 'workspace');
    const skills = path.join(workspace, '.claude/skills');
    mkdirSync(skills, { recursive: true });
    symlinkSync(old, path.join(skills, 'aionui-config'), process.platform === 'win32' ? 'junction' : 'dir');
    const user = path.join(skills, 'nexwork-troubleshooting');
    mkdirSync(user);
    writeFileSync(path.join(user, 'SKILL.md'), 'user-edited');
    db.prepare("UPDATE conversations SET extra=? WHERE id='old'").run(JSON.stringify({ workspace }));
    db.close();
    migrateNexworkTools(dir, root, open);
    expect(existsSync(path.join(skills, 'aionui-config'))).toBe(false);
    expect(realpathSync(path.join(skills, 'nexwork-config'))).toBe(realpathSync(next));
    expect(readFileSync(path.join(user, 'SKILL.md'), 'utf8')).toBe('user-edited');
  });
  it('restores a moved workspace link and MCP metadata if a later move fails', () => {
    const { dir, root, db, file } = fixture();
    const old = path.join(dir, 'builtin-skills/auto-inject/aionui-config');
    const next = path.join(root, 'auto-inject/nexwork-config');
    for (const p of [old, next]) {
      mkdirSync(p, { recursive: true });
      writeFileSync(path.join(p, 'SKILL.md'), 'test');
    }
    const targets = ['first', 'second'].map((id) => {
      const workspace = path.join(dir, id);
      const dirSkills = path.join(workspace, '.claude/skills');
      mkdirSync(dirSkills, { recursive: true });
      const target = path.join(dirSkills, 'aionui-config');
      symlinkSync(old, target, process.platform === 'win32' ? 'junction' : 'dir');
      if (id === 'second') writeFileSync(path.join(workspace, '.claude/nexwork-skill-backups'), 'blocked');
      db.prepare('INSERT INTO conversations VALUES (?,?)').run(id, JSON.stringify({ workspace }));
      return target;
    });
    db.close();
    expect(() => migrateNexworkTools(dir, root, open)).toThrow('ENOTDIR');
    expect(
      targets.every((target) => existsSync(target) && !existsSync(path.join(path.dirname(target), 'nexwork-config')))
    ).toBe(true);
    const check = new DatabaseSync(file);
    const name = check.prepare("SELECT name FROM mcp_servers WHERE id='browser'").get()?.name;
    check.close();
    expect(name).toBe('aionui-browser');
  });

  it('retires obsolete global skill catalog rows without deleting a user skill with the same name', () => {
    const { dir, root, db, file } = fixture();
    db.exec(`CREATE TABLE skills (id TEXT, name TEXT, source TEXT, user_id TEXT, enabled INTEGER, deleted_at INTEGER);
      INSERT INTO skills VALUES ('old','aionui-config','builtin',NULL,1,NULL);
      INSERT INTO skills VALUES ('new','nexwork-config','builtin',NULL,1,NULL);
      INSERT INTO skills VALUES ('personal','aionui-config','user','employee',1,NULL);`);
    db.close();
    migrateNexworkTools(dir, root, open);
    const check = new DatabaseSync(file);
    const visible = check.prepare('SELECT id,name FROM skills WHERE deleted_at IS NULL ORDER BY id').all();
    check.close();
    expect(visible).toEqual([
      { id: 'new', name: 'nexwork-config' },
      { id: 'personal', name: 'aionui-config' },
    ]);
  });

  it('does not retire a skill before all stored JSON is validated', () => {
    const { dir, root, db, file } = fixture();
    db.exec("UPDATE conversations SET extra='not JSON'");
    db.close();
    expect(() => migrateNexworkTools(dir, root, open)).toThrow();
    const check = new DatabaseSync(file);
    const name = check.prepare("SELECT name FROM mcp_servers WHERE id='browser'").get()?.name;
    check.close();
    expect(name).toBe('aionui-browser');
  });
});
