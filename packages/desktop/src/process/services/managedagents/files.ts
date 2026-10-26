/** Immutable skill installation. Existing conversation symlinks keep their original targets. */
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { ManagedCatalog, ManagedSkill } from '@/common/deptconfig/catalog';

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const orderedFiles = (skill: ManagedSkill): string =>
  JSON.stringify(Object.fromEntries(Object.entries(skill.files).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));

/** IDs include content hashes so two revisions can coexist in a shared workspace. */
export function managedSkillId(name: string, skill: ManagedSkill): string {
  return `${name}-nw-${sha256(orderedFiles(skill)).slice(0, 12)}`;
}

const INTEGRITY_DIRECTORY = '.integrity';
type SkillIntegrity = { version: 1; id: string; originalNameLine: string | null };

function integrityFile(root: string, id: string): string {
  const directory = path.join(root, INTEGRITY_DIRECTORY);
  if (existsSync(directory) && (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()))
    throw new Error('Managed skill integrity directory is not a regular directory');
  return path.join(directory, `${id}.json`);
}

/** Check immutable bytes against their content ID, including historical mounts. */
export function verifyManagedSkillIntegrity(directory: string, id: string): void {
  const identity = /^(.+)-nw-([a-f0-9]{12})$/.exec(id);
  if (!identity) throw new Error('Managed skill has no immutable content identity');
  const files: Record<string, string> = {};
  const visit = (current: string, prefix = ''): void => {
    if (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink())
      throw new Error('Managed skill source is not a regular directory');
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      const relative = prefix + entry.name;
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(target, `${relative}/`);
      else if (entry.isFile() && !entry.isSymbolicLink()) {
        if (lstatSync(target).size > 256 * 1024 || Object.keys(files).length >= 100)
          throw new Error('Managed skill content exceeds its catalog limits');
        files[relative] = readFileSync(target, 'utf8');
      } else throw new Error('Managed skill source contains an unsupported file');
    }
  };
  visit(directory);
  if (!files['SKILL.md']) throw new Error('Managed skill manifest is missing');
  const metadata = integrityFile(path.dirname(directory), id);
  if (existsSync(metadata)) {
    const info = lstatSync(metadata);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024)
      throw new Error('Invalid managed skill integrity record');
    const record = JSON.parse(readFileSync(metadata, 'utf8')) as SkillIntegrity | null;
    if (
      !record ||
      record.version !== 1 ||
      record.id !== id ||
      (record.originalNameLine !== null && typeof record.originalNameLine !== 'string')
    )
      throw new Error('Invalid managed skill integrity record');
    if (record.originalNameLine !== null) {
      const expectedName = record.originalNameLine.replace(/^(name:\s*).+$/m, `$1${id}`);
      if (files['SKILL.md'].match(/^(name:\s*).+$/m)?.[0] !== expectedName)
        throw new Error('Immutable managed skill content was modified; restore this exact installed version');
      files['SKILL.md'] = files['SKILL.md'].replace(/^(name:\s*).+$/m, () => record.originalNameLine!);
    }
  } else {
    // Official historical packages used their catalog key as the unquoted name.
    // Recover that exact old representation; never substitute the current release.
    const name = files['SKILL.md'].match(/^(name:\s*)(.+)$/m);
    if (!name || name[2] !== id) throw new Error('Immutable managed skill name was modified');
    files['SKILL.md'] = files['SKILL.md'].replace(/^(name:\s*).+$/m, `$1${identity[1]}`);
  }
  if (managedSkillId(identity[1], { files }) !== id)
    throw new Error('Immutable managed skill content was modified; restore this exact installed version');
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
      writeManagedJson(integrityFile(root, id), {
        version: 1,
        id,
        originalNameLine: skill.files['SKILL.md'].match(/^(name:\s*).+$/m)?.[0] ?? null,
      } satisfies SkillIntegrity);
      verifyManagedSkillIntegrity(target, id);
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
      writeManagedJson(integrityFile(root, id), {
        version: 1,
        id,
        originalNameLine: skill.files['SKILL.md'].match(/^(name:\s*).+$/m)?.[0] ?? null,
      } satisfies SkillIntegrity);
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
