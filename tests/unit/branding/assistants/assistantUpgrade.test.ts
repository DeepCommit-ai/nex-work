import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareNexworkClaudeProfile } from '@/branding/assistants/claudeProfile';
import { NEXWORK_BASE_RULES } from '@/branding/assistants/prompts';
const dirs: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nexwork-profile-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});
describe('Claude common NexWork rules', () => {
  it('preserves other settings and repairs a stale style in the effective config directory', () => {
    const dir = temp();
    const file = path.join(dir, 'settings.json');
    const existing = { permissions: { defaultMode: 'default' }, env: { EXAMPLE: 'retained' }, outputStyle: 'Default' };
    writeFileSync(file, JSON.stringify(existing));
    prepareNexworkClaudeProfile(dir);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ...existing, outputStyle: 'NexWork' });
    const styleFile = path.join(dir, 'output-styles/nexwork.md');
    writeFileSync(styleFile, 'stale');
    prepareNexworkClaudeProfile(dir);
    expect(readFileSync(styleFile, 'utf8')).toContain('keep-coding-instructions: false');
    expect(readFileSync(styleFile, 'utf8')).not.toContain(NEXWORK_BASE_RULES);
    expect(readFileSync(styleFile, 'utf8')).not.toMatch(/office assistant|Word|Excel|PowerPoint/);
  });

  it('does not replace malformed user settings with an empty configuration', () => {
    const dir = temp();
    const file = path.join(dir, 'settings.json');
    writeFileSync(file, '{broken');
    expect(() => prepareNexworkClaudeProfile(dir)).toThrow();
    expect(readFileSync(file, 'utf8')).toBe('{broken');
    expect(() => prepareNexworkClaudeProfile('../relative')).toThrow('absolute');
  });
});
