/** Read-verify native skill mounts before starting an employee turn. */
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const unprefix = (value: string): string =>
  value.startsWith('\\\\?\\UNC\\') ? '\\\\' + value.slice(8) : value.replace(/^\\\\\?\\/, '');
const samePath = (left: string, right: string): boolean =>
  path.resolve(unprefix(left)).toLowerCase() === path.resolve(unprefix(right)).toLowerCase();
const ORIGIN_FILE = '.nexwork-origin.json';
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,127}$/;

function inspectDirectory(directory: string): void {
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
    throw new Error('Managed skill source is not a regular directory');
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Managed skill source contains a symbolic link');
    if (entry.isDirectory()) inspectDirectory(path.join(directory, entry.name));
    else if (!entry.isFile()) throw new Error('Managed skill source contains an unsupported file');
  }
}

function validateManagedSource(recorded: string, name: string, skillsRoot: string): string | undefined {
  const root = path.dirname(skillsRoot);
  const target = path.resolve(unprefix(recorded));
  const components = path.relative(root, target).split(path.sep);
  const expected =
    components.length === 2
      ? path.join(root, components[0], name)
      : components.length === 3 && components[1] === 'auto-inject'
        ? path.join(root, components[0], 'auto-inject', name)
        : '';
  if (!/^[a-f0-9]{16}$/.test(components[0] ?? '') || !expected || !samePath(target, expected)) return undefined;
  if (
    lstatSync(path.join(root, components[0])).isSymbolicLink() ||
    (components.length === 3 && lstatSync(path.join(root, components[0], 'auto-inject')).isSymbolicLink())
  )
    throw new Error('Managed skill source parent is a symbolic link');
  inspectDirectory(target);
  return target;
}

/**
 * Resolve the immutable installed source of a selected native mount. skillsRoot
 * is the current hash16 corpus directory, not its parent. Historical mount
 * targets and recovered-copy origins keep their original corpus revision.
 * Callers must separately verify that name is selected by this conversation.
 */
export function resolveManagedSkillSource(workspace: string, name: string, skillsRoot: string): string | undefined {
  if (!path.isAbsolute(workspace) || !path.isAbsolute(skillsRoot) || !SKILL_NAME.test(name))
    throw new Error('Invalid managed skill location');
  const mounted = path.join(workspace, '.claude', 'skills', name);
  const entry = lstatSync(mounted, { throwIfNoEntry: false });
  if (!entry) return undefined;
  if (entry.isSymbolicLink()) return validateManagedSource(readlinkSync(mounted), name, skillsRoot);
  if (!entry.isDirectory()) return undefined;
  const marker = path.join(mounted, ORIGIN_FILE);
  const markerEntry = lstatSync(marker, { throwIfNoEntry: false });
  if (markerEntry) {
    if (!markerEntry.isFile() || markerEntry.isSymbolicLink() || markerEntry.size > 2048)
      throw new Error('Invalid managed skill origin');
    const parsed: unknown = JSON.parse(readFileSync(marker, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid managed skill origin');
    const origin = parsed as { version?: number; source?: string };
    if (
      origin.version !== 1 ||
      typeof origin.source !== 'string' ||
      !/^[a-f0-9]{16}\/(?:auto-inject\/)?[a-z0-9-]+$/.test(origin.source)
    )
      throw new Error('Invalid managed skill origin');
    return validateManagedSource(path.join(path.dirname(skillsRoot), ...origin.source.split('/')), name, skillsRoot);
  }
  // AionCore's earlier copy fallback had no origin marker. Content-addressed
  // IDs let us recover its source without guessing a newer skill version.
  if (!/-nw-[a-f0-9]{12}$/.test(name)) return undefined;
  const manifest = readFileSync(path.join(mounted, 'SKILL.md'), 'utf8');
  for (const version of readdirSync(path.dirname(skillsRoot))) {
    if (!/^[a-f0-9]{16}$/.test(version)) continue;
    const candidate = path.join(path.dirname(skillsRoot), version, name);
    if (!lstatSync(candidate, { throwIfNoEntry: false })) continue;
    const source = validateManagedSource(candidate, name, skillsRoot);
    if (source && readFileSync(path.join(source, 'SKILL.md'), 'utf8') === manifest) return source;
  }
  return undefined;
}

/**
 * Keep readable mounts untouched. A Windows Junction can exist and report the
 * right target while opening its SKILL.md fails. Replace only such a selected
 * managed mount with an atomic, immutable copy of its OWN recorded revision.
 * Never substitute the current catalog revision for a historical conversation.
 */
export function prepareWorkspaceSkills(
  workspace: string,
  names: readonly string[],
  skillsRoot: string,
  platform = process.platform,
  inspectOnly = false
): number {
  if (platform !== 'win32' || names.length === 0) return 0;
  if (!path.isAbsolute(workspace) || !path.isAbsolute(skillsRoot))
    throw new Error('Managed skill paths must be absolute');
  const parent = path.join(workspace, '.claude', 'skills');
  // Do not follow user-owned parent links when replacing an entry.
  for (const directory of [path.join(workspace, '.claude'), parent]) {
    const item = lstatSync(directory, { throwIfNoEntry: false });
    if (!item) return 0;
    if (!item.isDirectory() || item.isSymbolicLink())
      throw new Error('Native skill directory is not a regular directory');
  }
  let repaired = 0;
  for (const name of new Set(names)) {
    if (!SKILL_NAME.test(name)) throw new Error('Invalid selected skill name');
    const mounted = path.join(parent, name);
    try {
      readFileSync(path.join(mounted, 'SKILL.md'), 'utf8');
      continue;
    } catch {
      /* Verify and recover only host-installed mounts below. */
    }
    const entry = lstatSync(mounted, { throwIfNoEntry: false });
    if (!entry?.isSymbolicLink()) continue;
    const recordedTarget = resolveManagedSkillSource(workspace, name, skillsRoot);
    if (!recordedTarget) continue;
    if (inspectOnly) {
      repaired++;
      continue;
    }
    const source = readFileSync(path.join(recordedTarget, 'SKILL.md'), 'utf8');
    const stage = path.join(parent, `.stage-${randomUUID()}`);
    const backup = path.join(parent, `.mount-${randomUUID()}`);
    if (!path.resolve(stage).startsWith(path.resolve(workspace) + path.sep))
      throw new Error('Skill staging path escaped its workspace');
    let moved = false;
    try {
      mkdirSync(stage);
      cpSync(recordedTarget, stage, { recursive: true, errorOnExist: true, force: false });
      if (readFileSync(path.join(stage, 'SKILL.md'), 'utf8') !== source)
        throw new Error('Managed skill copy verification failed');
      writeFileSync(
        path.join(stage, ORIGIN_FILE),
        JSON.stringify({
          version: 1,
          source: path.relative(path.dirname(skillsRoot), recordedTarget).split(path.sep).join('/'),
        }),
        { mode: 0o600 }
      );
      renameSync(mounted, backup);
      moved = true;
      try {
        renameSync(stage, mounted);
      } catch (error) {
        renameSync(backup, mounted);
        moved = false;
        throw error;
      }
      // unlink removes the Junction itself, never its versioned source directory.
      unlinkSync(backup);
      moved = false;
      repaired++;
    } finally {
      // stage is always a freshly allocated, workspace-contained regular directory.
      rmSync(stage, { recursive: true, force: true });
      if (moved) {
        // Leave the backup mount recoverable if installation completed but cleanup failed.
        console.warn('[skills] Retained original unavailable mount for recovery');
      }
    }
  }
  return repaired;
}
