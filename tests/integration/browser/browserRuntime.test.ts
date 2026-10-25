import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Opt in locally with the same Electron and Node runtimes used by the desktop. */
describe.skipIf(process.env.NEXWORK_BROWSER_E2E !== '1')('isolated conversation browser runtime', () => {
  it('keeps page state and cookie sharing while parallel tools and file injection stay isolated', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nexwork-browser-build-'));
    const bun = process.env.NEXWORK_BROWSER_BUN ?? 'bun';
    const runtime = path.join(root, 'browserRuntime.cjs'),
      wrapper = path.join(root, 'browserServer.cjs');
    for (const [source, output] of [
      ['tests/integration/browser/browserRuntime.ts', runtime],
      ['packages/desktop/src/process/resources/builtinMcp/browserServer.ts', wrapper],
    ]) {
      const built = spawnSync(
        bun,
        ['build', source, '--target=node', '--format=cjs', '--external', 'electron', '--outfile', output],
        { encoding: 'utf8', windowsHide: true }
      );
      if (built.status !== 0) throw new Error(built.stderr || built.stdout);
    }
    const electron = path.resolve(
      'node_modules/electron/dist',
      process.platform === 'win32' ? 'electron.exe' : 'electron'
    );
    const environment = { ...process.env, NEXWORK_BROWSER_WRAPPER: wrapper };
    delete environment.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(electron, [runtime], {
      encoding: 'utf8',
      timeout: 170000,
      windowsHide: true,
      env: environment,
    });
    console.log(result.stdout);
    if (result.status !== 0) throw new Error(result.stderr + '\n' + result.stdout);
    const evidence = result.stdout.match(/Browser evidence: (.+)/)?.[1]?.trim();
    expect(evidence).toBeTruthy();
    const report = JSON.parse(readFileSync(path.join(evidence!, 'result.json'), 'utf8')) as {
      success: boolean;
      checks: string[];
    };
    expect(report.success).toBe(true);
    expect(report.checks.length).toBeGreaterThanOrEqual(process.env.NEXWORK_BROWSER_RAW_NAV ? 8 : 16);
  }, 190000);
});
