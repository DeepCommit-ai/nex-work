/** Pinned pure-Python wheels for managed exports; downloaded only at application build time. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const yauzl = require('yauzl');

const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const pinsAt = (projectRoot) =>
  JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).bundledPython;
const sitePath = (platform, version) =>
  platform === 'win32' ? 'Lib/site-packages' : `lib/python${version.split('.').slice(0, 2).join('.')}/site-packages`;

function verifyPythonPackages(bundle, pin, platform) {
  const root = path.join(bundle, 'nexwork-packages');
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'PACKAGES.json'), 'utf8'));
  if (metadata.pinHash !== hash(JSON.stringify(pin.packages))) throw new Error('Bundled Python package pins differ');
  for (const [relative, expected] of Object.entries(metadata.files)) {
    const target = path.resolve(root, relative);
    if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Invalid package manifest path');
    if (hash(fs.readFileSync(target)) !== expected) throw new Error(`Bundled Python package file differs: ${relative}`);
  }
  for (const pkg of pin.packages) {
    if (!metadata.files[`${pkg.module}/__init__.py`]) throw new Error(`Missing bundled module ${pkg.module}`);
  }
  const site = path.join(bundle, sitePath(platform, pin.version));
  const expectedPath = path.relative(site, root).split(path.sep).join('/') + '\n';
  if (fs.readFileSync(path.join(site, 'nexwork-packages.pth'), 'utf8') !== expectedPath)
    throw new Error('Bundled Python package path differs');
  return metadata;
}

async function extractWheel(bytes, dest) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      let failed = false;
      const fail = (e) => {
        if (!failed) {
          failed = true;
          zip.close();
          reject(e);
        }
      };
      zip.on('error', fail);
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        const target = path.resolve(dest, name);
        const fileType = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (
          !target.startsWith(path.resolve(dest) + path.sep) ||
          /[\\:]/.test(name) ||
          fileType === 0o120000 ||
          name.includes('.data/')
        )
          return fail(new Error('Unsafe or unsupported wheel path'));
        if (name.endsWith('/')) {
          fs.mkdirSync(target, { recursive: true });
          zip.readEntry();
          return;
        }
        if (fs.existsSync(target)) return fail(new Error('Wheel files conflict'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        zip.openReadStream(entry, (err, stream) => {
          if (err) return fail(err);
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', fail);
          stream.on('end', () => {
            if (!failed) {
              fs.writeFileSync(target, Buffer.concat(chunks));
              zip.readEntry();
            }
          });
        });
      });
      zip.readEntry();
    });
  });
}

async function preparePythonPackages({
  projectRoot,
  platform = process.platform,
  arch = process.arch,
  pin = pinsAt(projectRoot),
  download,
} = {}) {
  if (!Array.isArray(pin.packages) || !pin.packages.length)
    throw new Error('Pin the Python packages required by exports');
  const bundle = path.join(projectRoot, 'resources', 'bundled-python', `${platform}-${arch}`);
  const executable = path.join(bundle, platform === 'win32' ? 'python.exe' : 'bin/python3');
  if (!fs.existsSync(executable)) throw new Error('Prepare bundled Python before its packages');
  try {
    verifyPythonPackages(bundle, pin, platform);
    return;
  } catch {
    /* Restage incomplete packages. */
  }
  const stage = fs.mkdtempSync(path.join(bundle, '.packages-'));
  const destination = path.join(bundle, 'nexwork-packages');
  if (path.dirname(path.resolve(stage)) !== path.resolve(bundle)) throw new Error('Invalid staging target');
  try {
    for (const pkg of pin.packages) {
      if (
        !/^[0-9a-f]{64}$/.test(pkg.sha256 || '') ||
        !pkg.url.startsWith('https://') ||
        !pkg.url.endsWith('none-any.whl')
      )
        throw new Error('Only pinned pure-Python wheels are supported');
      const bytes = download ? await download(pkg.url) : Buffer.from(await (await fetchChecked(pkg.url)).arrayBuffer());
      if (hash(bytes) !== pkg.sha256) throw new Error(`Wheel SHA-256 mismatch: ${pkg.name}`);
      await extractWheel(bytes, stage);
    }
    const files = {};
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        if (fs.statSync(file).isDirectory()) walk(file);
        else files[path.relative(stage, file).split(path.sep).join('/')] = hash(fs.readFileSync(file));
      }
    };
    walk(stage);
    fs.writeFileSync(
      path.join(stage, 'PACKAGES.json'),
      JSON.stringify({ pinHash: hash(JSON.stringify(pin.packages)), files }, null, 2)
    );
    // Both paths are fixed children of this prepared bundle; never accept a caller-supplied deletion path.
    if (path.dirname(path.resolve(destination)) !== path.resolve(bundle)) throw new Error('Invalid bundle target');
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(stage, destination);
    const site = path.join(bundle, sitePath(platform, pin.version));
    fs.mkdirSync(site, { recursive: true });
    fs.writeFileSync(
      path.join(site, 'nexwork-packages.pth'),
      path.relative(site, destination).split(path.sep).join('/') + '\n'
    );
    verifyPythonPackages(bundle, pin, platform);
    if (platform === process.platform && arch === process.arch) {
      execFileSync(
        executable,
        [
          '-I',
          '-B',
          '-c',
          'import importlib.metadata as m, json, sys; expected=json.loads(sys.argv[1]); assert all(m.version(p["name"])==p["version"] for p in expected)',
          JSON.stringify(pin.packages),
        ],
        { timeout: 60000 }
      );
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

async function fetchChecked(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Wheel download failed: ${response.status}`);
  return response;
}

module.exports = { preparePythonPackages, verifyPythonPackages, extractWheel };
