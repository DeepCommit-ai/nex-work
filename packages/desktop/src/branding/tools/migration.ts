/** Migrate owned tool identities after backend schema initialization. */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BetterSqlite3Driver } from '@process/services/database/drivers/BetterSqlite3Driver';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { isNexworkAssistant, resolveNexworkAssistantId } from '../assistants/policy';
import { brandToolText, renameMcp, renameMcpConfig, renameSkill, SKILL_NAMES } from './policy';

type Row = Record<string, unknown>;
type Change = { table: string; key: string; id: unknown; before: Row; after: Row };
type Move = { from: string; backup: string; target: string; source?: string };
const json = JSON.stringify;
const list = (value: unknown): string[] => {
  const result: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(result) || !result.every((item) => typeof item === 'string'))
    throw new Error('Invalid stored skill list');
  return result;
};
const skills = (value: unknown, disabled = false): string[] => {
  const names = list(value);
  return [...new Set(disabled ? names.flatMap((name) => [name, renameSkill(name)]) : names.map(renameSkill))];
};
function sameTree(a: string, b: string): boolean {
  const left = lstatSync(a);
  const right = lstatSync(b);
  if (left.isSymbolicLink() || right.isSymbolicLink()) return false;
  if (left.isFile() && right.isFile()) return readFileSync(a).equals(readFileSync(b));
  if (!left.isDirectory() || !right.isDirectory()) return false;
  const names = readdirSync(a).toSorted();
  return (
    json(names) === json(readdirSync(b).toSorted()) &&
    names.every((name) => sameTree(path.join(a, name), path.join(b, name)))
  );
}
function planWorkspace(dataDir: string, root: string, workspace: string, retained: boolean): Move[] {
  if (!path.isAbsolute(workspace)) return [];
  const ownedRoots = [path.join(dataDir, 'builtin-skills'), path.join(dataDir, 'nexwork-resources', 'skills')];
  const moves: Move[] = [];
  for (const relative of ['.claude/skills', '.claude/skill', '.aionrs/skills']) {
    const dir = path.join(workspace, relative);
    if (!existsSync(dir)) continue;
    for (const oldName of readdirSync(dir)) {
      const name = renameSkill(oldName);
      const source = [path.join(root, name), path.join(root, 'auto-inject', name)].find(existsSync);
      if (!source) continue;
      const from = path.join(dir, oldName);
      if (!existsSync(from)) continue;
      const stat = lstatSync(from);
      const owned = stat.isSymbolicLink()
        ? ownedRoots.filter(existsSync).some((base) => realpathSync(from).startsWith(realpathSync(base) + path.sep))
        : [
            path.join(dataDir, 'builtin-skills', oldName),
            path.join(dataDir, 'builtin-skills', 'auto-inject', oldName),
            source,
          ]
            .filter(existsSync)
            .some((candidate) => sameTree(from, candidate));
      if (!owned) continue;
      const retired = retained && ['nexwork-config', 'nexwork-troubleshooting', 'nexwork-webui-public'].includes(name);
      if (
        !retired &&
        name === oldName &&
        (stat.isSymbolicLink() ? realpathSync(from) === realpathSync(source) : sameTree(from, source))
      )
        continue;
      const target = path.join(dir, name);
      if (from !== target && existsSync(target))
        throw new Error(`Cannot migrate skill: destination already exists (${target})`);
      moves.push({
        from,
        target,
        source: retired ? undefined : source,
        backup: path.join(workspace, path.dirname(relative), 'nexwork-skill-backups', randomUUID(), oldName),
      });
    }
  }
  return moves;
}

/** Preserve server IDs, credentials, permissions, messages, and user-authored files. */
export function migrateNexworkTools(
  dataDir: string,
  skillRoot: string,
  open: (file: string) => ISqliteDriver = (file) => new BetterSqlite3Driver(file)
): number {
  const db = open(path.join(dataDir, 'aionui-backend.db'));
  const moved: Move[] = [];
  const linked: string[] = [];
  let active = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    active = true;
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Row[]).map((row) => row.name)
    );
    const changes: Change[] = [];
    const add = (table: string, key: string, row: Row, values: Row): void => {
      const after = Object.fromEntries(Object.entries(values).filter(([name, value]) => value !== row[name]));
      if (Object.keys(after).length)
        changes.push({
          table,
          key,
          id: row[key],
          before: Object.fromEntries(Object.keys(after).map((name) => [name, row[name]])),
          after,
        });
    };
    // Startup upserts new skills but does not remove obsolete global catalog rows.
    if (tables.has('skills')) {
      const catalog = db
        .prepare("SELECT * FROM skills WHERE source='builtin' AND user_id IS NULL AND deleted_at IS NULL")
        .all() as Row[];
      for (const row of catalog) {
        const replacement = SKILL_NAMES[String(row.name)];
        if (!replacement) continue;
        if (!catalog.some((skill) => skill.name === replacement))
          throw new Error(`Missing replacement skill: ${replacement}`);
        add('skills', 'id', row, { deleted_at: Date.now(), enabled: 0 });
      }
    }
    const mcpIds = new Map<string, string>();
    if (tables.has('mcp_servers')) {
      const servers = db.prepare('SELECT * FROM mcp_servers WHERE deleted_at IS NULL').all() as Row[];
      for (const row of servers) {
        if (!row.builtin) continue;
        const name = renameMcp(String(row.name));
        if (name === row.name && !name.startsWith('nexwork-')) continue;
        if (servers.some((other) => other.id !== row.id && other.user_id === row.user_id && other.name === name))
          throw new Error(`MCP name collision: ${name}`);
        mcpIds.set(String(row.id), name);
        const patch: Row = {
          name,
          description: typeof row.description === 'string' ? brandToolText(row.description) : row.description,
        };
        if (typeof row.original_json === 'string' && row.original_json.trim()) {
          patch.original_json = renameMcpConfig(row.original_json, String(row.name), name);
        }
        if (typeof row.tools === 'string' && row.tools.trim()) {
          const tools = JSON.parse(row.tools) as Row[] | null;
          if (Array.isArray(tools))
            patch.tools = json(
              tools.map((tool) => ({
                ...tool,
                name: tool.name === 'aionui_image_generation' ? 'nexwork_image_generation' : tool.name,
                ...(typeof tool.description === 'string' ? { description: brandToolText(tool.description) } : {}),
              }))
            );
        }
        add('mcp_servers', 'id', row, patch);
      }
    }
    if (tables.has('assistant_definitions'))
      for (const row of db
        .prepare("SELECT * FROM assistant_definitions WHERE source='builtin' AND deleted_at IS NULL")
        .all() as Row[]) {
        const patch: Row = {};
        for (const key of ['default_skill_ids', 'custom_skill_names', 'default_disabled_builtin_skill_ids'])
          if (row[key] != null) patch[key] = json(skills(row[key], key === 'default_disabled_builtin_skill_ids'));
        add('assistant_definitions', 'id', row, patch);
      }
    const retainedConversations = new Set<string>();
    if (tables.has('conversation_assistant_snapshots'))
      for (const row of db
        .prepare("SELECT * FROM conversation_assistant_snapshots WHERE assistant_source='builtin'")
        .all() as Row[]) {
        if (isNexworkAssistant(resolveNexworkAssistantId(String(row.assistant_id))))
          retainedConversations.add(String(row.conversation_id));
        add('conversation_assistant_snapshots', 'conversation_id', row, {
          resolved_skill_ids: json(skills(row.resolved_skill_ids)),
          resolved_disabled_builtin_skill_ids: json(skills(row.resolved_disabled_builtin_skill_ids, true)),
        });
      }
    const workspaces = new Map<string, boolean>();
    if (tables.has('conversations'))
      for (const row of db.prepare('SELECT id,extra FROM conversations').all() as Row[]) {
        const extra = JSON.parse(String(row.extra)) as Row;
        const before = json(extra);
        if (Array.isArray(extra.skills)) extra.skills = skills(extra.skills);
        // IDs identify owned servers. Do not rename unrelated session-local servers.
        const ids = Array.isArray(extra.mcp_server_ids) ? extra.mcp_server_ids : [];
        if (Array.isArray(extra.mcp_servers))
          extra.mcp_servers = extra.mcp_servers.map((name) =>
            typeof name === 'string' && ids.some((id) => mcpIds.get(String(id)) === renameMcp(name))
              ? renameMcp(name)
              : name
          );
        if (Array.isArray(extra.mcp_statuses))
          extra.mcp_statuses = extra.mcp_statuses.map((status: Row) =>
            mcpIds.has(String(status.id)) ? { ...status, name: mcpIds.get(String(status.id)) } : status
          );
        if (json(extra) !== before) add('conversations', 'id', row, { extra: json(extra) });
        if (typeof extra.workspace === 'string')
          workspaces.set(
            extra.workspace,
            (workspaces.get(extra.workspace) ?? false) || retainedConversations.has(String(row.id))
          );
      }
    const moves = [...workspaces].flatMap(([workspace, retained]) =>
      planWorkspace(dataDir, skillRoot, workspace, retained)
    );
    if (changes.length || moves.length) {
      const backup = path.join(dataDir, 'nexwork-resources', 'migration-backups');
      mkdirSync(backup, { recursive: true, mode: 0o700 });
      writeFileSync(path.join(backup, `tools-${randomUUID()}.json`), json({ changes, moves }), {
        mode: 0o600,
        flag: 'wx',
      });
    }
    for (const change of changes)
      db.prepare(
        `UPDATE ${change.table} SET ${Object.keys(change.after)
          .map((key) => `${key}=?`)
          .join(',')} WHERE ${change.key}=?`
      ).run(...Object.values(change.after), change.id);
    for (const move of moves) {
      mkdirSync(path.dirname(move.backup), { recursive: true });
      renameSync(move.from, move.backup);
      moved.push(move);
      if (move.source) {
        symlinkSync(move.source, move.target, process.platform === 'win32' ? 'junction' : 'dir');
        linked.push(move.target);
      }
    }
    db.exec('COMMIT');
    active = false;
    return changes.length + moves.length;
  } catch (error) {
    const errors: unknown[] = [error];
    for (const target of linked.toReversed())
      try {
        unlinkSync(target);
      } catch (e) {
        errors.push(e);
      }
    for (const move of moved.toReversed())
      try {
        renameSync(move.backup, move.from);
      } catch (e) {
        errors.push(e);
      }
    if (active)
      try {
        db.exec('ROLLBACK');
      } catch (e) {
        errors.push(e);
      }
    if (errors.length > 1) {
      // oxlint-disable-next-line preserve-caught-error -- AggregateError's cause is the third argument.
      throw new AggregateError(errors, 'Tool migration rollback failed; inspect migration-backups', { cause: error });
    }
    throw error;
  } finally {
    db.close();
  }
}
