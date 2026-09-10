import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

describe.runIf(process.env.NEXWORK_MANAGED_E2E === '1')('managed catalog across native runtimes', () => {
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
    console.info(stdout);
  }, 190_000);
});
