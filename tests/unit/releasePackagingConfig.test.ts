import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const projectRoot = resolve(__dirname, '../..');
const itWithBash = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0 ? it : it.skip;

/** WSL's legacy bash.exe launcher does not preserve positional arguments. */
const usesWslBash =
  process.platform === 'win32' &&
  spawnSync('bash', ['-c', 'uname -s'], { encoding: 'utf8' }).stdout?.trim() === 'Linux';

function runBashFixture(script: string, directories: string[]) {
  const command =
    'export MOCK_VERSION=1.0.0; script=$1; shift; dirs=("$@"); if command -v wslpath >/dev/null 2>&1; then for i in "${!dirs[@]}"; do dirs[$i]="$(wslpath -u "${dirs[$i]}")"; done; fi; bash "$script" "${dirs[@]}"';
  const args = [
    '-c',
    command,
    'release-fixture',
    script,
    ...directories.map((directory) => directory.replace(/\\/g, '/')),
  ];
  return spawnSync(usesWslBash ? 'wsl.exe' : 'bash', usesWslBash ? ['--exec', 'bash', ...args] : args, {
    cwd: projectRoot,
    env: process.env,
    encoding: 'utf8',
  });
}

function readProjectFile(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

/** The product name electron-builder stamps onto every artifact name. */
function productName(): string {
  const match = readProjectFile('packages/desktop/electron-builder.yml').match(/^productName:\s*(.+)$/m);
  if (!match) throw new Error('productName missing from packages/desktop/electron-builder.yml');
  return match[1].trim();
}

function yamlBlock(content: string, key: string): string {
  const startMatch = content.match(new RegExp(`^${key}:\\s*$`, 'm'));
  if (!startMatch || startMatch.index === undefined) return '';

  const blockStart = startMatch.index + startMatch[0].length;
  const rest = content.slice(blockStart);
  const nextTopLevelKey = rest.search(/^[a-zA-Z][a-zA-Z0-9]*:\s*$/m);
  return nextTopLevelKey === -1 ? rest : rest.slice(0, nextTopLevelKey);
}

describe('release packaging configuration', () => {
  it('keeps mac zip artifacts enabled', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const macBlock = yamlBlock(config, 'mac');

    expect(macBlock).toContain('    - dmg');
    expect(macBlock).toContain('    - zip');
  });

  it('does not build Windows zip artifacts', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const winBlock = yamlBlock(config, 'win');

    expect(winBlock).toContain('    - nsis');
    expect(winBlock).not.toContain('    - zip');
  });

  it('uploads mac zip artifacts without a stale Windows zip glob', () => {
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');

    // Derived from productName rather than pinned: electron-builder builds
    // artifactName from ${productName}, so a rebrand must move this glob too.
    expect(workflow).toContain(`out/${productName()}-*-mac-*.zip`);
    expect(workflow).not.toContain(`out/${productName()}-*-win32-*.zip`);
  });

  it('looks for the Windows installer under the current product name', () => {
    const workflow = readProjectFile('.github/workflows/pr-checks.yml');

    expect(workflow).toContain(`-Filter "${productName()}-*-win-*.exe"`);
  });

  it('validates release assets against the configured product name', () => {
    // Both the fixture generator and the validator must read productName, or a
    // rebrand leaves them agreeing on a name electron-builder no longer emits.
    expect(readProjectFile('scripts/prepare-release-assets.sh')).toContain('${PRODUCT_NAME}-${VERSION}-mac-');
    expect(readProjectFile('scripts/create-mock-release-artifacts.sh')).toContain('${PRODUCT_NAME}-1.0.0-mac-');
    expect(readProjectFile('scripts/prepare-release-assets.sh')).not.toContain('AionUi-${VERSION}');
  });

  it('retries mac prepackaged builds with both dmg and zip targets', () => {
    const script = readProjectFile('scripts/build-with-builder.js');

    expect(script).toMatch(/--mac\s+dmg\s+zip\s+--\$\{targetArch\}\s+--prepackaged/);
  });

  itWithBash('fails release asset preparation when a mac zip is missing', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'aionui-release-assets-'));
    const artifactsDir = resolve(tempDir, 'build-artifacts');
    const outputDir = resolve(tempDir, 'release-assets');

    try {
      const createResult = runBashFixture('scripts/create-mock-release-artifacts.sh', [artifactsDir]);
      expect(createResult.status, createResult.stderr || createResult.stdout).toBe(0);

      rmSync(resolve(artifactsDir, 'macos-build-arm64', `${productName()}-1.0.0-mac-arm64.zip`), { force: true });

      const prepareResult = runBashFixture('scripts/prepare-release-assets.sh', [artifactsDir, outputDir]);

      expect(prepareResult.status).not.toBe(0);
      expect(`${prepareResult.stdout}\n${prepareResult.stderr}`).toContain('Missing macOS zip artifact');
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
