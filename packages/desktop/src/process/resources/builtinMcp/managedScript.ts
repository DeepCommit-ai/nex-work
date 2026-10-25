import { createHash } from 'node:crypto';
import { realpath, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveManagedSkillSource } from '@/process/services/managedagents/workspaceSkills';

export type ManagedScriptRequest = { skillId: string; relativePath: string };

/** Read only a selected, immutable skill's JavaScript, never an arbitrary model-supplied path. */
export async function readManagedScript(
  request: ManagedScriptRequest,
  context: { workspace: string; selectedSkills: string[]; skillsRoot: string }
): Promise<{ source: string; sha256: string }> {
  const { skillId, relativePath } = request;
  if (!context.selectedSkills.includes(skillId) || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(skillId))
    throw new Error('The requested skill is not selected for this conversation.');
  if (
    !relativePath ||
    /[\\:\0]/.test(relativePath) ||
    relativePath.startsWith('/') ||
    relativePath.split('/').some((part) => !part || part === '..' || part === '.') ||
    !relativePath.endsWith('.js')
  )
    throw new Error('A relative JavaScript file inside the selected skill is required.');
  const sourceRoot = resolveManagedSkillSource(context.workspace, skillId, context.skillsRoot);
  if (!sourceRoot) throw new Error('The managed skill is unavailable; reload its conversation runtime.');
  const skill = await realpath(sourceRoot);
  const file = await realpath(path.join(skill, relativePath));
  if (!inside(skill, file)) throw new Error('The script escapes its selected skill directory.');
  const info = await stat(file);
  if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Managed scripts must be files smaller than 1 MiB.');
  const source = await readFile(file, 'utf8');
  return { source, sha256: createHash('sha256').update(source).digest('hex') };
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return !!relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

/** Source serialization is deterministic; no model copies or escapes the script body. */
export function managedScriptFunction(script: { source: string; sha256: string }, key: string): string {
  return `() => { const key = ${JSON.stringify(key)}, hash = ${JSON.stringify(script.sha256)}; const cache = globalThis.__nexworkManagedScripts ??= Object.create(null); if (cache[key] === hash) return {status:'cached', sha256:hash}; (0,eval)(${JSON.stringify(script.source)}); cache[key] = hash; return {status:'loaded', sha256:hash}; }`;
}
