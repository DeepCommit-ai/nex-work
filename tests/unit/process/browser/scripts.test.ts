import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createBrowserProxy } from '@/process/resources/builtinMcp/browserProxy';
import { readManagedScript, managedScriptFunction } from '@/process/resources/builtinMcp/managedScript';
import { installManagedSkills } from '@/process/services/managedagents/files';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'nexwork-script-'));
  roots.push(root);
  const skillsRoot = path.join(root, 'installed', '0123456789abcdef');
  const names = installManagedSkills(skillsRoot, {
    schema_version: 1,
    common_rules: '',
    agents: [],
    skills: {
      test: {
        files: {
          'SKILL.md': '---\nname: test\ndescription: Test script\n---\n',
          'helper.js': 'globalThis.loaded = (globalThis.loaded ?? 0) + 1;\n' + '// quotes " \\ 汉字\n'.repeat(6000),
        },
      },
    },
  });
  const skill = path.join(skillsRoot, names.test);
  const workspace = path.join(root, 'workspace');
  await mkdir(skill, { recursive: true });
  await mkdir(path.join(workspace, '.claude', 'skills'), { recursive: true });
  await symlink(
    skill,
    path.join(workspace, '.claude', 'skills', names.test),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  return {
    root,
    skill,
    context: { skillsRoot, workspace, selectedSkills: [names.test] },
    request: { skillId: names.test, relativePath: 'helper.js' },
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
  it('rejects a changed immutable script instead of executing it and reports missing files', async () => {
    const f = await fixture(),
      context = vm.createContext({});
    const first = await readManagedScript(f.request, f.context);
    vm.runInContext(`(${managedScriptFunction(first, 'helper')})()`, context);
    await writeFile(path.join(f.skill, 'helper.js'), 'globalThis.loaded += 10;');
    await expect(readManagedScript(f.request, f.context)).rejects.toThrow('content was modified');
    expect(context.loaded).toBe(1);
    await expect(readManagedScript({ ...f.request, relativePath: 'missing.js' }, f.context)).rejects.toThrow();
  });
  it('verifies a historical canonical package without new integrity metadata', async () => {
    const f = await fixture();
    await rm(path.join(f.context.skillsRoot, '.integrity'), { recursive: true });
    expect((await readManagedScript(f.request, f.context)).source).toContain('globalThis.loaded');
    await writeFile(path.join(f.skill, 'helper.js'), 'throw new Error("corrupt");');
    await expect(readManagedScript(f.request, f.context)).rejects.toThrow('content was modified');
  });
  it('rejects changes elsewhere in the selected package and unexpected added files', async () => {
    const f = await fixture();
    await writeFile(path.join(f.skill, 'extra.js'), 'throw new Error("unexpected");');
    await expect(readManagedScript(f.request, f.context)).rejects.toThrow('content was modified');
    await rm(path.join(f.skill, 'extra.js'));
    await writeFile(path.join(f.skill, 'SKILL.md'), '---\nname: other\ndescription: Test script\n---\n');
    await expect(readManagedScript(f.request, f.context)).rejects.toThrow('content was modified');
  });
  it('preserves original quoted names when verifying an installed package', async () => {
    const f = await fixture();
    const names = installManagedSkills(f.context.skillsRoot, {
      schema_version: 1,
      common_rules: '',
      agents: [],
      skills: { quoted: { files: { 'SKILL.md': '---\nname: "quoted"\ndescription: Test\n---\n', 'helper.js': '1' } } },
    });
    await symlink(
      path.join(f.context.skillsRoot, names.quoted),
      path.join(f.context.workspace, '.claude', 'skills', names.quoted),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    expect(
      (
        await readManagedScript(
          { skillId: names.quoted, relativePath: 'helper.js' },
          { ...f.context, selectedSkills: [names.quoted] }
        )
      ).source
    ).toBe('1');
    expect((await readManagedScript(f.request, f.context)).source).toContain('globalThis.loaded');
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
