import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseManagedCatalog } from '@/common/deptconfig/catalog';
import { composeManagedRules, installManagedSkills } from '@process/services/managedagents/files';
import { catalogFixture, releaseFixture } from './managedFixture';
import { prepareWorkspaceSkills, resolveManagedSkillSource } from '@process/services/managedagents/workspaceSkills';
import { prepareManagedRuntime, setManagedRuntimePreparer } from '@/common/deptconfig/managedConversation';

const unavailableMounts = vi.hoisted(() => new Set<string>());
vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: (file: import('node:fs').PathOrFileDescriptor, ...args: unknown[]) => {
      if (
        typeof file === 'string' &&
        unavailableMounts.has(file) &&
        actual.lstatSync(path.dirname(file)).isSymbolicLink()
      ) {
        throw Object.assign(new Error('Unavailable Junction'), { code: 'ENOENT' });
      }
      return (actual.readFileSync as (...params: unknown[]) => unknown)(file, ...args);
    },
  };
});

const roots: string[] = [];
afterEach(() => {
  unavailableMounts.clear();
  setManagedRuntimePreparer();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('runtime preparation before sending a conversation turn', () => {
  it('waits for the desktop preflight on historical and new conversation messages', async () => {
    const prepare = vi.fn(async () => {});
    setManagedRuntimePreparer(prepare);
    await prepareManagedRuntime('POST', '/api/conversations/existing-conversation/messages');
    await prepareManagedRuntime('POST', '/api/conversations/new-conversation/side-question');
    expect(prepare.mock.calls).toEqual([['existing-conversation'], ['new-conversation']]);
  });

  it('propagates a preparation failure before the model turn can be sent', async () => {
    setManagedRuntimePreparer(async () => {
      throw new Error('Selected skill unavailable');
    });
    await expect(prepareManagedRuntime('POST', '/api/conversations/old-conversation/messages')).rejects.toThrow(
      'Selected skill unavailable'
    );
  });

  it('does not invoke the preflight for reads, configuration changes, or unrelated requests', async () => {
    const prepare = vi.fn(async () => {});
    setManagedRuntimePreparer(prepare);
    await prepareManagedRuntime('GET', '/api/conversations/old-conversation/messages');
    await prepareManagedRuntime('POST', '/api/conversations');
    await prepareManagedRuntime('PUT', '/api/assistants/office-assistant');
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('selected Windows runtime skill mounts', () => {
  const setup = (old = false) => {
    const root = temporary();
    const skillsRoot = path.join(root, 'skills', 'aaaaaaaaaaaaaaaa');
    const source = path.join(root, 'skills', old ? 'bbbbbbbbbbbbbbbb' : 'aaaaaaaaaaaaaaaa', 'review-nw-0123456789ab');
    const workspace = path.join(root, 'workspace');
    const mounted = path.join(workspace, '.claude', 'skills', 'review-nw-0123456789ab');
    mkdirSync(source, { recursive: true });
    mkdirSync(path.dirname(mounted), { recursive: true });
    writeFileSync(path.join(source, 'SKILL.md'), old ? 'historical version' : 'published version');
    symlinkSync(source, mounted, process.platform === 'win32' ? 'junction' : 'dir');
    return { root, skillsRoot, source, workspace, mounted, names: ['review-nw-0123456789ab'] };
  };

  it('keeps a readable Junction and its original target untouched', () => {
    const f = setup();
    expect(prepareWorkspaceSkills(f.workspace, f.names, f.skillsRoot, 'win32')).toBe(0);
    expect(lstatSync(f.mounted).isSymbolicLink()).toBe(true);
  });

  it('resolves the immutable source of a healthy selected Junction', () => {
    const f = setup();
    expect(resolveManagedSkillSource(f.workspace, f.names[0], f.skillsRoot)).toBe(f.source);
  });

  it('repairs an unreadable selected mount with verified files without modifying the source', () => {
    const f = setup();
    unavailableMounts.add(path.join(f.mounted, 'SKILL.md'));
    expect(prepareWorkspaceSkills(f.workspace, f.names, f.skillsRoot, 'win32')).toBe(1);
    expect(lstatSync(f.mounted).isSymbolicLink()).toBe(false);
    expect([
      readFileSync(path.join(f.mounted, 'SKILL.md'), 'utf8'),
      readFileSync(path.join(f.source, 'SKILL.md'), 'utf8'),
    ]).toEqual(['published version', 'published version']);
  });

  it('retains the historical target revision when a newer catalog is installed', () => {
    const f = setup(true);
    unavailableMounts.add(path.join(f.mounted, 'SKILL.md'));
    prepareWorkspaceSkills(f.workspace, f.names, f.skillsRoot, 'win32');
    expect(readFileSync(path.join(f.mounted, 'SKILL.md'), 'utf8')).toBe('historical version');
    expect(readdirSync(path.dirname(f.mounted))).toEqual(f.names);
  });

  it('resolves a recovered copy back to its historical source for file injection', () => {
    const f = setup(true);
    unavailableMounts.add(path.join(f.mounted, 'SKILL.md'));
    prepareWorkspaceSkills(f.workspace, f.names, f.skillsRoot, 'win32');
    expect(resolveManagedSkillSource(f.workspace, f.names[0], f.skillsRoot)).toBe(f.source);
  });

  it('resolves an old copy fallback by content-addressed ID without adopting a newer version', () => {
    const f = setup(true);
    unlinkSync(f.mounted);
    mkdirSync(f.mounted);
    writeFileSync(path.join(f.mounted, 'SKILL.md'), 'historical version');
    expect(resolveManagedSkillSource(f.workspace, f.names[0], f.skillsRoot)).toBe(f.source);
  });

  it('rejects a forged copy origin that escapes installed resource directories', () => {
    const f = setup();
    unavailableMounts.add(path.join(f.mounted, 'SKILL.md'));
    prepareWorkspaceSkills(f.workspace, f.names, f.skillsRoot, 'win32');
    writeFileSync(
      path.join(f.mounted, '.nexwork-origin.json'),
      JSON.stringify({ version: 1, source: '../../private' })
    );
    expect(() => resolveManagedSkillSource(f.workspace, f.names[0], f.skillsRoot)).toThrow(
      'Invalid managed skill origin'
    );
  });

  it('rejects malformed origin metadata without attempting to follow it', () => {
    const f = setup();
    unavailableMounts.add(path.join(f.mounted, 'SKILL.md'));
    prepareWorkspaceSkills(f.workspace, f.names, f.skillsRoot, 'win32');
    writeFileSync(path.join(f.mounted, '.nexwork-origin.json'), 'null');
    expect(() => resolveManagedSkillSource(f.workspace, f.names[0], f.skillsRoot)).toThrow(
      'Invalid managed skill origin'
    );
  });

  it('does not repair or replace an unselected mount', () => {
    const f = setup();
    unavailableMounts.add(path.join(f.mounted, 'SKILL.md'));
    expect(prepareWorkspaceSkills(f.workspace, [], f.skillsRoot, 'win32')).toBe(0);
    expect(lstatSync(f.mounted).isSymbolicLink()).toBe(true);
  });

  it('does not replace user-owned links outside the installed resource roots', () => {
    const f = setup();
    unavailableMounts.add(path.join(f.mounted, 'SKILL.md'));
    expect(prepareWorkspaceSkills(f.workspace, f.names, path.join(f.root, 'other', 'aaaaaaaaaaaaaaaa'), 'win32')).toBe(
      0
    );
    expect(lstatSync(f.mounted).isSymbolicLink()).toBe(true);
  });

  it('does not remove the old mount when its source contains another symlink', () => {
    const f = setup();
    const outside = path.join(f.root, 'private');
    mkdirSync(outside);
    symlinkSync(outside, path.join(f.source, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    unavailableMounts.add(path.join(f.mounted, 'SKILL.md'));
    expect(() => prepareWorkspaceSkills(f.workspace, f.names, f.skillsRoot, 'win32')).toThrow('symbolic link');
    expect(lstatSync(f.mounted).isSymbolicLink()).toBe(true);
    expect(existsSync(outside)).toBe(true);
  });
});
const temporary = (): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'managed-skills-'));
  roots.push(root);
  return root;
};

describe('published catalog validation', () => {
  it('accepts old catalogs without recommendations and new localized recommendations', () => {
    const catalog = catalogFixture();
    expect(parseManagedCatalog(releaseFixture(1, catalog)).agents[1].recommended_prompts).toBeUndefined();
    catalog.agents[1].recommended_prompts = ['Create a report'];
    catalog.agents[1].recommended_prompts_i18n = { 'zh-CN': ['生成一份报告'] };
    expect(parseManagedCatalog(releaseFixture(2, catalog)).agents[1].recommended_prompts_i18n).toEqual({
      'zh-CN': ['生成一份报告'],
    });
  });

  it.each([null, 'not-an-array', [''], [42], ['中'.repeat(342)], Array(13).fill('Prompt')])(
    'rejects malformed recommended prompts: %j',
    (value) => {
      const catalog = catalogFixture();
      Object.assign(catalog.agents[1], { recommended_prompts: value });
      expect(() => parseManagedCatalog(releaseFixture(1, catalog))).toThrow('assistant');
    }
  );

  it('rejects invalid recommendation locales and recommendations for the default assistant', () => {
    const catalog = catalogFixture();
    catalog.agents[1].recommended_prompts_i18n = { invalid: ['Prompt'] };
    expect(() => parseManagedCatalog(releaseFixture(1, catalog))).toThrow('assistant');
    delete catalog.agents[1].recommended_prompts_i18n;
    catalog.agents[0].recommended_prompts_i18n = { 'zh-CN': ['不应显示'] };
    expect(() => parseManagedCatalog(releaseFixture(1, catalog))).toThrow('recommended');
  });

  it('accepts bundled avatar identifiers and rejects untrusted image locations', () => {
    const catalog = catalogFixture();
    catalog.agents[1].avatar = 'office-documents';
    catalog.agents[2].avatar = 'nexwork-logo';
    expect(parseManagedCatalog(releaseFixture(1, catalog)).agents[2].avatar).toBe('nexwork-logo');
    Object.assign(catalog.agents[2], { avatar: '/Users/employee/private.png' });
    expect(() => parseManagedCatalog(releaseFixture(1, catalog))).toThrow('assistant');
  });

  it('requires the default and reserves Aion for the Butler', () => {
    const catalog = catalogFixture();
    catalog.agents[1].engine = 'aion';
    expect(() => parseManagedCatalog(releaseFixture(1, catalog))).toThrow('assistant');
    catalog.agents.shift();
    expect(() => parseManagedCatalog(releaseFixture(1, catalog))).toThrow();
  });
  it('rejects path traversal before files are written', () => {
    const catalog = catalogFixture();
    catalog.skills['office-docs'].files['../outside'] = 'bad';
    expect(() => parseManagedCatalog(releaseFixture(1, catalog))).toThrow('file');
  });
  it('does not allow a specialized default prompt', () => {
    const catalog = catalogFixture();
    catalog.agents[0].rules = 'Only create slides';
    expect(() => parseManagedCatalog(releaseFixture(1, catalog))).toThrow('dedicated');
  });
});

describe('immutable skill materialization', () => {
  it('keeps old workspace links unchanged when a new revision is installed', () => {
    const root = temporary();
    const catalog = catalogFixture();
    const before = installManagedSkills(root, catalog);
    const link = path.join(root, 'old-conversation');
    symlinkSync(path.join(root, before['office-docs']), link, process.platform === 'win32' ? 'junction' : 'dir');
    catalog.skills['office-docs'].files['SKILL.md'] += '\nVersion two';
    const after = installManagedSkills(root, catalog);
    expect(after['office-docs']).not.toBe(before['office-docs']);
    expect(readFileSync(path.join(link, 'SKILL.md'), 'utf8')).not.toContain('Version two');
    expect(readFileSync(path.join(root, after['office-docs'], 'SKILL.md'), 'utf8')).toContain('Version two');
  });
  it('rejects a modified immutable directory instead of silently accepting corrupt content', () => {
    const root = temporary();
    const catalog = catalogFixture();
    const names = installManagedSkills(root, catalog);
    writeFileSync(path.join(root, names['office-docs'], 'scripts/read.txt'), 'corrupt');
    expect(() => installManagedSkills(root, catalog)).toThrow('modified');
  });
  it('injects common rules once and resolves skill references to the installed version', () => {
    const catalog = catalogFixture();
    const rules = composeManagedRules(catalog, catalog.agents[1].rules, { 'office-docs': 'office-docs-nw-123' }, 7);
    expect(rules.match(/Use NexWork/g)).toHaveLength(1);
    expect(rules).toContain('Use office-docs-nw-123.');
    expect(rules).toContain('revision 7');
    expect(composeManagedRules(catalog, 'Use office-docs MCP.', { 'office-docs': 'office-docs-nw-123' }, 7)).toContain(
      'office-docs MCP'
    );
  });
});
