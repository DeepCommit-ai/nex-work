/** Upgrade product-owned copies before the pinned backend opens its database. */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { BetterSqlite3Driver } from '@process/services/database/drivers/BetterSqlite3Driver';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import metadata from './metadata.json';
import { NEXWORK_ASSISTANT_RULES } from './prompts';
import { isNexworkAssistant, LEGACY_ASSISTANT_ID, NEXWORK_ASSISTANT_ID } from './policy';

type Row = Record<string, unknown>;
type Change = { table: string; key: string; id: string; before: Row; after: Row };
const RULE_SKILLS = {
  'word-creator': ['officecli-docx'],
  'ppt-creator': ['officecli-pptx'],
  'excel-creator': ['officecli-xlsx'],
  'nexwork-assistant': [],
} as const;
const json = (value: unknown): string => JSON.stringify(value);

function identicalTree(left: string, right: string): boolean {
  const a = lstatSync(left);
  const b = lstatSync(right);
  if (a.isSymbolicLink() || b.isSymbolicLink()) return false;
  if (a.isFile() && b.isFile()) return readFileSync(left).equals(readFileSync(right));
  if (!a.isDirectory() || !b.isDirectory()) return false;
  const names = readdirSync(left).toSorted();
  return (
    json(names) === json(readdirSync(right).toSorted()) &&
    names.every((name) => identicalTree(path.join(left, name), path.join(right, name)))
  );
}

/** Quarantine only links/copies that still match the backend-owned skill resource. */
function retireWorkspaceSkills(dataDir: string, workspace: string, retired: Set<string>): void {
  if (!path.isAbsolute(workspace)) return;
  for (const relative of ['.claude/skills', '.claude/skill', '.aion/skills', '.aion/skill']) {
    for (const name of retired) {
      const target = path.join(workspace, relative, name);
      if (!existsSync(target)) continue;
      const sources = [
        path.join(dataDir, 'builtin-skills', name),
        path.join(dataDir, 'builtin-skills', 'auto-inject', name),
      ].filter(existsSync);
      const stat = lstatSync(target);
      const owned = sources.some((source) =>
        stat.isSymbolicLink() ? realpathSync(target) === realpathSync(source) : identicalTree(target, source)
      );
      if (!owned) continue;
      const quarantine = path.join(workspace, path.dirname(relative), 'nexwork-disabled-skills');
      mkdirSync(quarantine, { recursive: true });
      renameSync(target, path.join(quarantine, `${name}-${Date.now()}-${process.pid}`));
    }
  }
}

/** Preserve history and runtime choices while refreshing built-in profile copies and rules. */
export function migrateNexworkAssistantData(
  dataDir: string,
  open: (file: string) => ISqliteDriver = (file) => new BetterSqlite3Driver(file)
): number {
  const file = path.join(dataDir, 'aionui-backend.db');
  if (!existsSync(file)) return 0;
  const db = open(file);
  try {
    db.exec('BEGIN IMMEDIATE');
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (row) => row.name
      )
    );
    const changes: Change[] = [];
    const add = (table: string, key: string, row: Row, after: Row): void => {
      const changed = Object.fromEntries(Object.entries(after).filter(([name, value]) => row[name] !== value));
      if (Object.keys(changed).length)
        changes.push({
          table,
          key,
          id: String(row[key]),
          before: Object.fromEntries(Object.keys(changed).map((name) => [name, row[name]])),
          after: changed,
        });
    };
    if (tables.has('assistant_definitions')) {
      for (const row of db
        .prepare("SELECT * FROM assistant_definitions WHERE source = 'builtin' AND deleted_at IS NULL")
        .all() as Row[]) {
        const id = row.assistant_id === LEGACY_ASSISTANT_ID ? NEXWORK_ASSISTANT_ID : String(row.assistant_id);
        if (!isNexworkAssistant(id)) continue;
        const key = id as keyof (typeof metadata)['en-US'];
        const copy = metadata['en-US'][key];
        add('assistant_definitions', 'id', row, {
          name: copy.name,
          description: copy.description,
          name_i18n: json(
            Object.fromEntries(Object.entries(metadata).map(([locale, values]) => [locale, values[key].name]))
          ),
          description_i18n: json(
            Object.fromEntries(Object.entries(metadata).map(([locale, values]) => [locale, values[key].description]))
          ),
          default_skill_ids: json(RULE_SKILLS[key]),
          custom_skill_names: '[]',
          default_disabled_builtin_skill_ids: '["aionui-config"]',
          ...(id === NEXWORK_ASSISTANT_ID
            ? {
                avatar_type: 'builtin_asset',
                avatar_value: 'avatars/nexwork-assistant.svg',
                recommended_prompts: json(copy.prompts),
                recommended_prompts_i18n: json(
                  Object.fromEntries(Object.entries(metadata).map(([locale, values]) => [locale, values[key].prompts]))
                ),
              }
            : {}),
        });
      }
    }
    if (tables.has('conversation_assistant_snapshots')) {
      for (const row of db
        .prepare("SELECT * FROM conversation_assistant_snapshots WHERE assistant_source = 'builtin'")
        .all() as Row[]) {
        const id = row.assistant_id === LEGACY_ASSISTANT_ID ? NEXWORK_ASSISTANT_ID : String(row.assistant_id);
        if (!isNexworkAssistant(id)) continue;
        const retired = new Set([
          'aionui-config',
          ...(id === NEXWORK_ASSISTANT_ID ? ['aionui-troubleshooting', 'aionui-webui-public'] : []),
        ]);
        const skills = (JSON.parse(String(row.resolved_skill_ids)) as string[]).filter((skill) => !retired.has(skill));
        const disabled = [
          ...new Set([...(JSON.parse(String(row.resolved_disabled_builtin_skill_ids)) as string[]), 'aionui-config']),
        ];
        add('conversation_assistant_snapshots', 'conversation_id', row, {
          rules_content: NEXWORK_ASSISTANT_RULES[id],
          resolved_skill_ids: json(skills),
          resolved_disabled_builtin_skill_ids: json(disabled),
        });
        if (tables.has('conversations')) {
          const conversation = db
            .prepare('SELECT id, extra FROM conversations WHERE id = ?')
            .get(row.conversation_id) as Row | undefined;
          if (conversation) {
            const extra = JSON.parse(String(conversation.extra)) as Record<string, unknown>;
            if (typeof extra.workspace === 'string') retireWorkspaceSkills(dataDir, extra.workspace, retired);
            if (Array.isArray(extra.skills)) {
              const next = extra.skills.filter((skill) => typeof skill !== 'string' || !retired.has(skill));
              if (next.length !== extra.skills.length)
                add('conversations', 'id', conversation, { extra: json({ ...extra, skills: next }) });
            }
          }
        }
      }
    }
    if (changes.length) {
      const backupDir = path.join(dataDir, 'nexwork-resources', 'migration-backups');
      mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      writeFileSync(path.join(backupDir, `assistants-${Date.now()}-${process.pid}.json`), json(changes), {
        mode: 0o600,
        flag: 'wx',
      });
      for (const change of changes) {
        const fields = Object.keys(change.after);
        db.prepare(
          `UPDATE ${change.table} SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE ${change.key} = ?`
        ).run(...Object.values(change.after), change.id);
      }
    }
    db.exec('COMMIT');
    return changes.length;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}
