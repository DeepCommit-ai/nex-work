import { describe, it, expect } from 'vitest';
import { buildNexworkSkills } from '@/branding/tools/resources';
import { runInNewContext } from 'node:vm';
import { localBundleMetadata, localAppBootstrap } from '../../../../packages/desktop/src/branding/tools/localApp.mjs';
import { SKILL_NAMES, renameMcpConfig } from '@/branding/tools/policy';

describe('shipped tool branding', () => {
  it('renames the four application skills and removes old onboarding documents', () => {
    const files = buildNexworkSkills();
    const names = Object.keys(files).filter((name) => name.endsWith('/SKILL.md'));
    for (const [oldName, newName] of Object.entries(SKILL_NAMES)) {
      expect(names.some((name) => name.endsWith(`/${oldName}/SKILL.md`) || name === `${oldName}/SKILL.md`)).toBe(false);
      expect(names.some((name) => name.endsWith(`/${newName}/SKILL.md`) || name === `${newName}/SKILL.md`)).toBe(true);
    }
    expect(Object.keys(files).some((name) => name.includes('aionui'))).toBe(false);
  });
  it('keeps the office skills and backend protocol tokens intact', () => {
    const files = buildNexworkSkills();
    expect(files['auto-inject/nexwork-config/SKILL.md'].toString()).toContain('$AIONUI_HELPER_BIN');
    expect(files['weixin-file-send/SKILL.md'].toString()).toContain('[AIONUI_CHANNEL_SEND]');
    expect(['docx', 'pptx', 'xlsx'].every((kind) => files[`officecli-${kind}/SKILL.md`])).toBe(true);
  });
  it('does not leave upstream product prose in shipped skill Markdown', () => {
    const files = buildNexworkSkills();
    expect(
      Object.entries(files)
        .filter(([name]) => name.endsWith('.md'))
        .filter(([, content]) => /Aion(?:Ui|UI| UI)/.test(content.toString()))
        .map(([name]) => name)
    ).toEqual([]);
  });
  it('renames native bundle metadata without changing Electron framework contracts', () => {
    const input =
      '<plist><dict><key>CFBundleName</key><string>Electron</string><key>CFBundleExecutable</key><string>Electron</string><key>Unrelated</key><string>preserved</string></dict></plist>';
    const result = localBundleMetadata(input);
    expect(result).toContain('<key>CFBundleExecutable</key><string>NexWork</string>');
    expect(result).toContain('<key>Unrelated</key><string>preserved</string>');
    expect(localBundleMetadata(result)).toBe(result);
  });
});

describe('legacy MCP editable configuration', () => {
  it('keeps transport secrets intact while renaming the owned key', () => {
    const config = { mcpServers: { 'aionui-browser': { command: 'node', env: { TOKEN: 'unchanged' } } } };
    expect(JSON.parse(renameMcpConfig(JSON.stringify(config), 'aionui-browser', 'nexwork-browser'))).toEqual({
      mcpServers: { 'nexwork-browser': config.mcpServers['aionui-browser'] },
    });
  });
  it('rejects a colliding key instead of overwriting a configured server', () => {
    expect(() =>
      renameMcpConfig('{"mcpServers":{"aionui-browser":{},"nexwork-browser":{}}}', 'aionui-browser', 'nexwork-browser')
    ).toThrow('collision');
  });
});

describe('branded local launch mode', () => {
  it('restores development mode and the repository path before loading application code', () => {
    const app = {
      isPackaged: true,
      appPath: '',
      version: '37.10.3',
      setVersion(value: string) {
        this.version = value;
      },
      setAppPath(value: string) {
        this.appPath = value;
      },
    };
    let loaded = false;
    runInNewContext(localAppBootstrap('/repo with spaces'), {
      require(name: string) {
        if (name === 'electron') return { app };
        if (name === '/repo with spaces/package.json') return { version: '2.1.61' };
        expect(app).toMatchObject({ isPackaged: false, appPath: '/repo with spaces', version: '2.1.61' });
        loaded = name === '/repo with spaces/out/main/index.js';
        return {};
      },
    });
    expect(loaded).toBe(true);
  });
});
