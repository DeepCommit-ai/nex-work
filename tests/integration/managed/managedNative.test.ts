import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

describe.runIf(process.env.NEXWORK_MANAGED_FOCUS === 'skills')('selected Windows skill mount recovery', () => {
  it('repairs an unreadable published mount before the bundled Claude invokes Skill', async () => {
    const { stdout } = await promisify(execFile)('bun', ['tests/integration/managed/managedRuntime.ts'], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    expect(stdout).toContain('PASS: published catalog -> native workspace -> bundled Claude Skill invocation');
    expect(stdout).not.toContain('Unknown skill');
    if (process.platform === 'win32') expect(stdout).toContain('PASS: selected Windows mount read failure recovered');
  }, 130_000);
});

describe.runIf(process.env.NEXWORK_MANAGED_E2E === '1' && process.env.NEXWORK_MANAGED_FOCUS !== 'skills')(
  'managed catalog across native runtimes',
  () => {
    it('installs in two clients, pushes changes, preserves history and executes both engines', async () => {
      const { stdout } = await promisify(execFile)('bun', ['tests/integration/managed/managedRuntime.ts'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 180_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      expect(stdout).toContain('PASS: two native clients');
      expect(stdout).toContain('PASS: actual Aion conversation');
      expect(stdout).toContain('PASS: bundled Claude Code');
      expect(stdout).toContain('PASS: aion branded workspace');
      expect(stdout).toContain('PASS: claude branded workspace');
      if (process.env.NEXWORK_MANAGED_UI === '1') {
        expect(stdout).toContain('PASS: Electron data root, saved directory defaults and historical paths migrated');
      }
      console.info(stdout);
    }, 190_000);
  }
);
