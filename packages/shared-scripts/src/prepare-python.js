/**
 * [ENTERPRISE PATCH] Prepare the pinned standalone CPython that ships inside NexWork.
 *
 * Managed skills run Python scripts (the purchase requisition review rules engine is
 * standard-library Python), and employee machines cannot be assumed to have an
 * interpreter: Windows has none (its `python.exe` is a Microsoft Store alias), and
 * macOS only has a stub until the Command Line Tools are installed. The installer
 * therefore carries its own interpreter, fetched at build time and verified against
 * the SHA-256 pinned in the root package.json (`bundledPython`); nothing is
 * downloaded on the employee machine.
 *
 * Output: {projectRoot}/resources/bundled-python/{platform}-{arch}/
 *   - bin/python3 (macOS/Linux) or python.exe (Windows) plus the standard library
 *   - VERSION, written last: it witnesses a complete, verified extraction
 *
 * Source: python-build-standalone `install_only_stripped` archives.
 * NEXWORK_PYTHON_BASE_URL may point at a mirror of the same release; the pinned
 * hash still decides what is accepted.
 *
 * @module prepare-python
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = 'https://github.com/astral-sh/python-build-standalone/releases/download';

const PYTHON_TRIPLES = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
};

function resolvePythonPin(projectRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  const pin = pkg.bundledPython;
  if (!pin || !/^\d+\.\d+\.\d+$/.test(pin.version || '') || !/^\d{8}$/.test(pin.release || '') || !pin.sha256) {
    throw new Error('package.json "bundledPython" must pin version, release and per-platform sha256');
  }
  return pin;
}

function pythonAssetName(pin, runtimeKey) {
  const triple = PYTHON_TRIPLES[runtimeKey];
  if (!triple) throw new Error(`No bundled Python build for ${runtimeKey}`);
  return `cpython-${pin.version}+${pin.release}-${triple}-install_only_stripped.tar.gz`;
}

/** Interpreter path inside the bundle, relative to bundled-python/<plat>-<arch>/. */
function pythonExecutable(platform) {
  return platform === 'win32' ? 'python.exe' : path.join('bin', 'python3');
}

/**
 * What the bundle does not need: package installers (the bundle is read-only and must stay
 * the pinned standard library), the Tk GUI stack, and C headers. Each rule is a directory
 * relative to the bundle root and a pattern for entries removed from it; missing ones are fine.
 */
function pruneRules(platform, version) {
  const minor = version.split('.').slice(0, 2).join('.');
  const stdlib = platform === 'win32' ? 'Lib' : `lib/python${minor}`;
  const common = [
    ['.', /^include$/],
    [stdlib, /^(ensurepip|idlelib|tkinter|turtledemo|lib2to3)$/],
    [`${stdlib}/site-packages`, /^pip([-_.].*)?$/],
  ];
  if (platform === 'win32') {
    return [...common, ['.', /^(libs|tcl)$/], ['DLLs', /^(_tkinter\.pyd|tcl\d+t?\.dll|tk\d+t?\.dll)$/]];
  }
  return [
    ...common,
    ['.', /^share$/],
    ['bin', /^(idle|pip|2to3|pydoc)|-config$/],
    ['lib', /^(itcl|tcl|tk|thread|libtcl|libtk|pkgconfig)/],
    [`${stdlib}/lib-dynload`, /^_tkinter\./],
  ];
}

function pruneBundle(root, platform, version) {
  for (const [dir, pattern] of pruneRules(platform, version)) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      if (pattern.test(name)) fs.rmSync(path.join(base, name), { recursive: true, force: true });
    }
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function downloadFile(url, outputPath) {
  console.log(`[prepare-python] downloading ${url}`);
  if (process.platform === 'win32') {
    const ps = `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${outputPath.replace(/'/g, "''")}'`;
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 600_000 });
    return;
  }
  execFileSync('curl', ['-L', '--fail', '--silent', '--show-error', '--retry', '3', '-o', outputPath, url], {
    timeout: 600_000,
  });
}

/**
 * Download, verify, extract and prune the pinned interpreter. Idempotent: an existing bundle
 * whose VERSION matches the pin is kept. Returns the interpreter path.
 */
function preparePython({
  projectRoot,
  platform = process.platform,
  arch = process.arch,
  pin = resolvePythonPin(projectRoot),
  download = downloadFile,
  baseUrl = process.env.NEXWORK_PYTHON_BASE_URL || DEFAULT_BASE_URL,
} = {}) {
  const runtimeKey = `${platform}-${arch}`;
  const expected = pin.sha256[runtimeKey];
  const assetName = pythonAssetName(pin, runtimeKey);
  if (!/^[0-9a-f]{64}$/.test(expected || '')) throw new Error(`bundledPython.sha256 has no pin for ${runtimeKey}`);

  const parent = path.join(projectRoot, 'resources', 'bundled-python');
  const destDir = path.join(parent, runtimeKey);
  const versionFile = path.join(destDir, 'VERSION');
  const executable = path.join(destDir, pythonExecutable(platform));
  const stamp = `${pin.version}+${pin.release}`;
  if (
    fs.existsSync(executable) &&
    fs.existsSync(versionFile) &&
    fs.readFileSync(versionFile, 'utf-8').trim() === stamp
  ) {
    console.log(`[prepare-python] ${runtimeKey} ${stamp} already in place (skipped)`);
    return executable;
  }

  fs.mkdirSync(parent, { recursive: true });
  // Stage beside the destination so the final move is a rename on the same filesystem.
  const staging = fs.mkdtempSync(path.join(parent, '.staging-'));
  try {
    const archive = path.join(staging, assetName);
    download(`${baseUrl}/${pin.release}/${encodeURIComponent(assetName)}`, archive);
    const actual = sha256File(archive);
    if (actual !== expected) {
      throw new Error(`${assetName} sha256 ${actual} does not match the pinned ${expected}`);
    }
    execFileSync('tar', ['-xzf', archive, '-C', staging], { timeout: 300_000 });
    const extracted = path.join(staging, 'python');
    if (!fs.existsSync(path.join(extracted, pythonExecutable(platform)))) {
      throw new Error(`${assetName} has no python/${pythonExecutable(platform)}; did the archive layout change?`);
    }
    pruneBundle(extracted, platform, pin.version);

    fs.rmSync(destDir, { recursive: true, force: true });
    fs.renameSync(extracted, destDir);
    if (platform === process.platform && arch === process.arch) {
      // The interpreter can run here: prove the pruned bundle still imports what skills use.
      execFileSync(executable, ['-I', '-c', 'import argparse, csv, datetime, json, pathlib, re, statistics'], {
        timeout: 60_000,
      });
    }
    fs.writeFileSync(versionFile, `${stamp}\n`);
    console.log(`[prepare-python] ready: ${executable} (${stamp})`);
    return executable;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

if (require.main === module) {
  const options = {
    projectRoot: path.resolve(__dirname, '..', '..', '..'),
    platform: argValue('--platform') || process.platform,
    arch: argValue('--arch') || process.arch,
  };
  preparePython(options);
  require('./prepare-python-packages')
    .preparePythonPackages(options)
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  PYTHON_TRIPLES,
  preparePython,
  pruneRules,
  pythonAssetName,
  pythonExecutable,
  resolvePythonPin,
};
