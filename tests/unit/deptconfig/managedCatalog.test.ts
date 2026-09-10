import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseManagedCatalog } from '@/common/deptconfig/catalog';
import { composeManagedRules, installManagedSkills } from '@process/services/managedagents/files';
import { catalogFixture, releaseFixture } from './managedFixture';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const temporary = (): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'managed-skills-'));
  roots.push(root);
  return root;
};

describe('published catalog validation', () => {
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
    symlinkSync(path.join(root, before['office-docs']), link, 'dir');
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
