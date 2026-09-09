import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateNexworkAssistantData } from '@/branding/assistants/migration';
import { prepareNexworkClaudeProfile } from '@/branding/assistants/claudeProfile';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { NEXWORK_ASSISTANT_RULES } from '@/branding/assistants/prompts';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nexwork-upgrade-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const open = (file: string) => new DatabaseSync(file) as unknown as ISqliteDriver;

describe('existing installations', () => {
  it('retires the old butler skills and quarantines owned workspace links while preserving user edits', () => {
    const dir = temp();
    const source = path.join(dir, 'builtin-skills/auto-inject/aionui-config');
    const workspace = path.join(dir, 'work');
    const skills = path.join(workspace, '.claude/skills');
    mkdirSync(source, { recursive: true });
    mkdirSync(skills, { recursive: true });
    writeFileSync(path.join(source, 'SKILL.md'), 'old configuration skill');
    symlinkSync(source, path.join(skills, 'aionui-config'), process.platform === 'win32' ? 'junction' : 'dir');
    mkdirSync(path.join(skills, 'aionui-troubleshooting'));
    writeFileSync(path.join(skills, 'aionui-troubleshooting/SKILL.md'), 'user-owned content');
    const db = new DatabaseSync(path.join(dir, 'aionui-backend.db'));
    db.exec(
      "CREATE TABLE conversation_assistant_snapshots (conversation_id TEXT, assistant_id TEXT, assistant_source TEXT, rules_content TEXT, resolved_skill_ids TEXT, resolved_disabled_builtin_skill_ids TEXT); INSERT INTO conversation_assistant_snapshots VALUES ('butler','aionui-assistant','builtin','old rule','[\"aionui-config\",\"aionui-troubleshooting\",\"aionui-webui-public\",\"user-skill\"]','[]'); CREATE TABLE conversations (id TEXT, extra TEXT)"
    );
    db.prepare('INSERT INTO conversations VALUES (?, ?)').run(
      'butler',
      JSON.stringify({
        workspace,
        skills: ['aionui-config', 'aionui-troubleshooting', 'aionui-webui-public', 'user-skill'],
      })
    );
    db.close();
    expect(migrateNexworkAssistantData(dir, open)).toBe(2);
    expect(existsSync(path.join(skills, 'aionui-config'))).toBe(false);
    expect(readdirSync(path.join(workspace, '.claude/nexwork-disabled-skills'))).toHaveLength(1);
    expect(readFileSync(path.join(skills, 'aionui-troubleshooting/SKILL.md'), 'utf8')).toBe('user-owned content');
    const check = new DatabaseSync(path.join(dir, 'aionui-backend.db'));
    expect(
      check.prepare('SELECT rules_content, resolved_skill_ids FROM conversation_assistant_snapshots').get()
    ).toEqual({ rules_content: NEXWORK_ASSISTANT_RULES['nexwork-assistant'], resolved_skill_ids: '["user-skill"]' });
    check.close();
  });
  it('refreshes user-owned builtin copies and conversation rules without changing messages or model choices', () => {
    const dir = temp();
    const file = path.join(dir, 'aionui-backend.db');
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE assistant_definitions (id TEXT, assistant_id TEXT, source TEXT, user_id TEXT, name TEXT, description TEXT, name_i18n TEXT, description_i18n TEXT, default_skill_ids TEXT, custom_skill_names TEXT, default_disabled_builtin_skill_ids TEXT, default_model_value TEXT, agent_id TEXT, deleted_at INTEGER);
      INSERT INTO assistant_definitions VALUES ('office-copy','word-creator','builtin','employee','Word Creator','','{}','{}','[]','[]','[]','company-model','claude',NULL);
      INSERT INTO assistant_definitions VALUES ('custom','other','user','employee','Personal','','{}','{}','[]','[]','[]','personal-model','claude',NULL);
      CREATE TABLE conversation_assistant_snapshots (conversation_id TEXT, assistant_id TEXT, assistant_source TEXT, rules_content TEXT, resolved_skill_ids TEXT, resolved_disabled_builtin_skill_ids TEXT, resolved_model_id TEXT);
      INSERT INTO conversation_assistant_snapshots VALUES ('old-conv','word-creator','builtin','old AionUi rule','["officecli-docx","aionui-config","user-skill"]','[]','company-model');
      INSERT INTO conversation_assistant_snapshots VALUES ('other-conv','other','user','user rule','[]','[]','personal-model');
      CREATE TABLE conversations (id TEXT, extra TEXT);
      INSERT INTO conversations VALUES ('old-conv','{"skills":["officecli-docx","aionui-config","user-skill"],"workspace":"/user/work"}');
      CREATE TABLE messages (content TEXT);
      INSERT INTO messages VALUES ('Historical AionUi response');`);
    db.close();
    expect(migrateNexworkAssistantData(dir, open)).toBe(3);
    expect(migrateNexworkAssistantData(dir, open)).toBe(0);
    const result = new DatabaseSync(file);
    expect(
      result
        .prepare(
          "SELECT name, default_model_value, agent_id, default_disabled_builtin_skill_ids FROM assistant_definitions WHERE id='office-copy'"
        )
        .get()
    ).toEqual({
      name: 'Word Assistant',
      default_model_value: 'company-model',
      agent_id: 'claude',
      default_disabled_builtin_skill_ids: '["aionui-config"]',
    });
    expect(
      result
        .prepare(
          "SELECT rules_content, resolved_skill_ids, resolved_model_id FROM conversation_assistant_snapshots WHERE conversation_id='old-conv'"
        )
        .get()
    ).toEqual({
      rules_content: NEXWORK_ASSISTANT_RULES['word-creator'],
      resolved_skill_ids: '["officecli-docx","user-skill"]',
      resolved_model_id: 'company-model',
    });
    expect(result.prepare('SELECT content FROM messages').get()?.content).toBe('Historical AionUi response');
    expect(
      result
        .prepare("SELECT rules_content FROM conversation_assistant_snapshots WHERE conversation_id='other-conv'")
        .get()?.rules_content
    ).toBe('user rule');
    expect(JSON.parse(String(result.prepare('SELECT extra FROM conversations').get()?.extra))).toEqual({
      skills: ['officecli-docx', 'user-skill'],
      workspace: '/user/work',
    });
    result.close();
  });

  it('rolls back rather than partly migrating an incompatible snapshot', () => {
    const dir = temp();
    const file = path.join(dir, 'aionui-backend.db');
    const db = new DatabaseSync(file);
    db.exec(
      "CREATE TABLE conversation_assistant_snapshots (conversation_id TEXT, assistant_id TEXT, assistant_source TEXT, rules_content TEXT, resolved_skill_ids TEXT, resolved_disabled_builtin_skill_ids TEXT); INSERT INTO conversation_assistant_snapshots VALUES ('broken','word-creator','builtin','old rule','not json','[]')"
    );
    db.close();
    expect(() => migrateNexworkAssistantData(dir, open)).toThrow();
    const check = new DatabaseSync(file);
    expect(check.prepare('SELECT rules_content FROM conversation_assistant_snapshots').get()?.rules_content).toBe(
      'old rule'
    );
    check.close();
  });
});

describe('Claude default office role', () => {
  it('preserves other settings and repairs a stale style in the effective config directory', () => {
    const dir = temp();
    const file = path.join(dir, 'settings.json');
    const existing = { permissions: { defaultMode: 'default' }, env: { EXAMPLE: 'retained' }, outputStyle: 'Default' };
    writeFileSync(file, JSON.stringify(existing));
    prepareNexworkClaudeProfile(dir);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...existing, outputStyle: 'NexWork' });
    const styleFile = path.join(dir, 'output-styles/nexwork.md');
    writeFileSync(styleFile, 'stale');
    prepareNexworkClaudeProfile(dir);
    expect(readFileSync(styleFile, 'utf8')).toContain('keep-coding-instructions: false');
    expect(readFileSync(styleFile, 'utf8')).toContain(NEXWORK_ASSISTANT_RULES['word-creator'].split('\n')[0]);
  });

  it('does not replace malformed user settings with an empty configuration', () => {
    const dir = temp();
    const file = path.join(dir, 'settings.json');
    writeFileSync(file, '{broken');
    expect(() => prepareNexworkClaudeProfile(dir)).toThrow();
    expect(readFileSync(file, 'utf8')).toBe('{broken');
    expect(() => prepareNexworkClaudeProfile('../relative')).toThrow('absolute');
  });
});
