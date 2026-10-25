import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createBrowserProxy } from '@/process/resources/builtinMcp/browserProxy';
import { readManagedScript, managedScriptFunction } from '@/process/resources/builtinMcp/managedScript';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'nexwork-script-'));
  roots.push(root);
  const skillsRoot = path.join(root, 'installed', '0123456789abcdef'),
    skill = path.join(skillsRoot, 'test-nw-0123456789ab');
  const workspace = path.join(root, 'workspace');
  await mkdir(skill, { recursive: true });
  await mkdir(path.join(workspace, '.claude', 'skills'), { recursive: true });
  await symlink(
    skill,
    path.join(workspace, '.claude', 'skills', 'test-nw-0123456789ab'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  await writeFile(
    path.join(skill, 'helper.js'),
    'globalThis.loaded = (globalThis.loaded ?? 0) + 1;\n' + '// quotes " \\ 汉字\n'.repeat(6000)
  );
  await writeFile(path.join(skill, 'SKILL.md'), '---\nname: test-nw-0123456789ab\ndescription: Test script\n---\n');
  return {
    root,
    skill,
    context: { skillsRoot, workspace, selectedSkills: ['test-nw-0123456789ab'] },
    request: { skillId: 'test-nw-0123456789ab', relativePath: 'helper.js' },
  };
}
describe('managed file injection', () => {
  it('loads large source once, caches per page, and loads again after navigation', async () => {
    const f = await fixture(),
      script = await readManagedScript(f.request, f.context);
    const expression = `(${managedScriptFunction(script, 'helper')})()`;
    const context = vm.createContext({});
    expect(vm.runInContext(expression, context).status).toBe('loaded');
    expect([vm.runInContext(expression, context).status, context.loaded]).toEqual(['cached', 1]);
    expect(vm.runInNewContext(expression).status).toBe('loaded');
  });
  it('rejects unselected skills, traversal and a symlink escaping the installed skill', async () => {
    const f = await fixture();
    await expect(readManagedScript({ ...f.request, skillId: 'other' }, f.context)).rejects.toThrow('not selected');
    await expect(readManagedScript({ ...f.request, relativePath: '../helper.js' }, f.context)).rejects.toThrow(
      'relative'
    );
    await symlink(f.root, path.join(f.skill, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(path.join(f.root, 'outside.js'), '1');
    await expect(readManagedScript({ ...f.request, relativePath: 'escape/outside.js' }, f.context)).rejects.toThrow(
      /symbolic link|escapes/
    );
  });
  it('does not cache a script that throws', () => {
    const context = vm.createContext({});
    const expression = `(${managedScriptFunction({ source: 'throw new Error("broken")', sha256: 'bad' }, 'helper')})()`;
    expect(() => vm.runInContext(expression, context)).toThrow('broken');
    expect(() => vm.runInContext(expression, context)).toThrow('broken');
    expect(Object.keys(context.__nexworkManagedScripts)).toEqual([]);
  });
  it('reloads a changed content hash and reports missing files', async () => {
    const f = await fixture(),
      context = vm.createContext({});
    const first = await readManagedScript(f.request, f.context);
    vm.runInContext(`(${managedScriptFunction(first, 'helper')})()`, context);
    await writeFile(path.join(f.skill, 'helper.js'), 'globalThis.loaded += 10;');
    const changed = await readManagedScript(f.request, f.context);
    expect(changed.sha256).not.toBe(first.sha256);
    expect(vm.runInContext(`(${managedScriptFunction(changed, 'helper')})()`, context).status).toBe('loaded');
    await expect(readManagedScript({ ...f.request, relativePath: 'missing.js' }, f.context)).rejects.toThrow();
  });
  it('advertises the file tool and rewrites only that call to upstream evaluation', async () => {
    const f = await fixture(),
      proxy = createBrowserProxy((input) => readManagedScript(input, f.context));
    await proxy.request('{"id":1,"method":"tools/list"}');
    const list = JSON.parse(proxy.response('{"id":1,"result":{"tools":[{"name":"evaluate_script"}]}}'));
    expect(list.result.tools.map((entry: { name: string }) => entry.name)).toContain('inject_managed_script');
    const rewritten = JSON.parse(
      await proxy.request(
        JSON.stringify({ id: 2, method: 'tools/call', params: { name: 'inject_managed_script', arguments: f.request } })
      )
    );
    expect([rewritten.id, rewritten.params.name, typeof rewritten.params.arguments.function]).toEqual([
      2,
      'evaluate_script',
      'string',
    ]);
    await expect(
      proxy.request('{"id":3,"method":"tools/call","params":{"name":"inject_managed_script","arguments":{}}}')
    ).rejects.toThrow('required');
  });
});
