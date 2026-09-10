/** Immutable skill installation. Existing conversation symlinks keep their original targets. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ManagedCatalog, ManagedSkill } from '@/common/deptconfig/catalog';

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const orderedFiles = (skill: ManagedSkill): string =>
  JSON.stringify(Object.fromEntries(Object.entries(skill.files).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));

/** IDs include content hashes so two revisions can coexist in a shared workspace. */
export function managedSkillId(name: string, skill: ManagedSkill): string {
  return `${name}-nw-${sha256(orderedFiles(skill)).slice(0, 12)}`;
}

/** Atomically replace a private state file, preserving the last complete value on failure. */
export function writeManagedJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Materialize only validated text files under a host-selected root. */
export function installManagedSkills(root: string, catalog: ManagedCatalog): Record<string, string> {
  mkdirSync(root, { recursive: true });
  if (lstatSync(root).isSymbolicLink()) throw new Error('Managed skill root must not be a symbolic link');
  const names: Record<string, string> = {};
  for (const [name, skill] of Object.entries(catalog.skills)) {
    const id = managedSkillId(name, skill);
    const target = path.join(root, id);
    names[name] = id;
    const files = Object.fromEntries(
      Object.entries(skill.files).map(([relative, text]) => [
        relative,
        relative === 'SKILL.md' ? text.replace(/^(name:\s*).+$/m, `$1${id}`) : text,
      ])
    );
    if (existsSync(target)) {
      if (lstatSync(target).isSymbolicLink()) throw new Error('Managed skill target is a symbolic link');
      for (const [relative, text] of Object.entries(files)) {
        const file = path.join(target, relative);
        let parent = path.dirname(file);
        while (parent !== target) {
          if (!existsSync(parent) || lstatSync(parent).isSymbolicLink())
            throw new Error('Managed skill parent is not a directory');
          parent = path.dirname(parent);
        }
        if (!existsSync(file) || lstatSync(file).isSymbolicLink() || readFileSync(file, 'utf8') !== text)
          throw new Error(`Immutable managed skill was modified: ${id}`);
      }
      continue;
    }
    const temporary = path.join(root, `.stage-${randomUUID()}`);
    try {
      for (const [relative, text] of Object.entries(files)) {
        const file = path.join(temporary, relative);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, text, { mode: 0o600 });
      }
      renameSync(temporary, target);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
  return names;
}

/** Rules reference the installed skill IDs and carry an explicit release marker for diagnosis. */
export function composeManagedRules(
  catalog: ManagedCatalog,
  rules: string,
  names: Record<string, string>,
  revision: number
): string {
  let text = [catalog.common_rules.trim(), rules.trim()].filter(Boolean).join('\n\n');
  for (const [name, id] of Object.entries(names).toSorted(([a], [b]) => b.length - a.length)) {
    text = text.replaceAll(`{{skill:${name}}}`, id);
  }
  return `${text}\n\n<!-- NexWork managed catalog revision ${revision} -->\n`;
}
