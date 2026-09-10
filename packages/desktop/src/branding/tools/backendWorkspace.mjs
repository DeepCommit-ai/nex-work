/** Build the pinned backend with the NexWork workspace naming patch. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const BACKEND_COMMIT = '57a34cc1b1a3b17bcc023de06b9e6768fceac36f';
export const BACKEND_VERSION = 'v0.1.72';
export const RUST_VERSION = '1.95.0';
const directory = path.dirname(fileURLToPath(import.meta.url));
const patchPath = path.join(directory, 'workspace-prefix.patch');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Reject unsupported targets instead of silently bundling an upstream binary. */
export function backendTarget(platform, arch) {
  const cpu = { x64: 'x86_64', arm64: 'aarch64' }[arch];
  const suffix = { darwin: 'apple-darwin', win32: 'pc-windows-msvc', linux: 'unknown-linux-gnu' }[platform];
  if (!cpu || !suffix) throw new Error(`Unsupported NexWork backend target: ${platform}-${arch}`);
  return `${cpu}-${suffix}`;
}

/** Bind cached artifacts to the upstream commit, toolchain, target and patch bytes. */
export function backendBuildKey(target, patch) {
  return sha256(
    `${BACKEND_COMMIT}\n${RUST_VERSION}\n${target}\n${patch}\n${sha256(fs.readFileSync(fileURLToPath(import.meta.url)))}`
  );
}

/** Produce the branded native binary and record verifiable build provenance. */
export function buildWorkspaceBackend({ projectRoot, platform, arch, version, output }) {
  if (version !== BACKEND_VERSION) throw new Error(`Review the NexWork backend patch before upgrading ${version}`);
  if (platform !== process.platform) throw new Error('Build the NexWork backend on its target operating system');
  const target = backendTarget(platform, arch);
  const patch = fs.readFileSync(patchPath, 'utf8').replaceAll('\r\n', '\n');
  const buildKey = backendBuildKey(target, patch);
  const cache = path.join(projectRoot, '.analysis/nexwork-backend');
  const source = path.join(cache, 'source');
  const binaryName = platform === 'win32' ? 'aioncore.exe' : 'aioncore';
  const cached = path.join(cache, 'binaries', target, buildKey, binaryName);
  let validCache = false;
  if (fs.existsSync(cached) && fs.existsSync(`${cached}.sha256`)) {
    validCache = sha256(fs.readFileSync(cached)) === fs.readFileSync(`${cached}.sha256`, 'utf8');
  }
  if (!validCache) {
    const env = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_RELEASE_LTO: 'false' };
    env.RUSTFLAGS = platform === 'win32' ? '-C target-feature=+crt-static' : '';
    // Local bootstrap may use an isolated toolchain without changing the user's PATH.
    const toolchain = path.join(projectRoot, '.analysis/toolchains');
    if (fs.existsSync(path.join(toolchain, 'cargo/bin/cargo'))) {
      env.CARGO_HOME = path.join(toolchain, 'cargo');
      env.RUSTUP_HOME = path.join(toolchain, 'rustup');
      env.PATH = `${path.join(toolchain, 'cargo/bin')}${path.delimiter}${env.PATH ?? ''}`;
    }
    const run = (command, args, cwd = source) =>
      execFileSync(command, args, { cwd, env, stdio: 'pipe', encoding: 'utf8' });
    fs.mkdirSync(cache, { recursive: true });
    if (!fs.existsSync(source)) {
      run(
        'git',
        [
          '-c',
          'core.autocrlf=false',
          'clone',
          '--depth',
          '1',
          '--branch',
          BACKEND_VERSION,
          'https://github.com/iOfficeAI/AionCore.git',
          source,
        ],
        projectRoot
      );
    }
    if (run('git', ['rev-parse', 'HEAD']).trim() !== BACKEND_COMMIT)
      throw new Error('Unexpected backend source revision');
    const normalizedPatch = path.join(cache, 'workspace-prefix.patch');
    fs.writeFileSync(normalizedPatch, patch);
    if (!run('git', ['diff', '--binary']).trim()) run('git', ['apply', '--whitespace=error', normalizedPatch]);
    if (run('git', ['diff', '--binary']).trim() !== patch.trim())
      throw new Error('Backend source differs from the reviewed NexWork patch');
    const host = run('rustc', [`+${RUST_VERSION}`, '-vV']).match(/^host: (.+)$/m)?.[1];
    const cross = target !== host;
    if (cross) run('rustup', ['target', 'add', '--toolchain', RUST_VERSION, target]);
    console.log(`Building NexWork backend ${BACKEND_VERSION} for ${target}`);
    execFileSync(
      'cargo',
      [
        `+${RUST_VERSION}`,
        'build',
        '--locked',
        '--release',
        ...(cross ? ['--target', target] : []),
        '-p',
        'aionui-app',
        '--bin',
        'aioncore',
      ],
      { cwd: source, env, stdio: 'inherit' }
    );
    const built = path.join(source, 'target', ...(cross ? [target] : []), 'release', binaryName);
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.copyFileSync(built, cached);
    fs.writeFileSync(`${cached}.sha256`, sha256(fs.readFileSync(cached)));
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(cached, output);
  const manifest = {
    platform,
    arch,
    version,
    generatedAt: new Date().toISOString(),
    sourceType: 'nexwork-source',
    source: {
      commit: BACKEND_COMMIT,
      patchSha256: sha256(patch),
      rustVersion: RUST_VERSION,
      target,
      buildKey,
      binarySha256: sha256(fs.readFileSync(output)),
    },
    files: [binaryName, 'managed-resources/'],
  };
  fs.writeFileSync(path.join(path.dirname(output), 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [projectRoot, platform, arch, version, output] = process.argv.slice(2);
  buildWorkspaceBackend({ projectRoot, platform, arch, version, output });
}
