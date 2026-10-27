/** Pinned chrome-devtools-mcp for the in-app browser tools; downloaded at build time, never on an employee machine. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const integrityOf = (bytes) => `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;
// The mirror serves the same tarball; the pinned integrity makes either origin safe.
const ORIGINS = ['https://registry.npmjs.org', 'https://registry.npmmirror.com'];

/** Regular files of an npm package tarball (ustar, optional pax paths), keyed by their path under `package/`. */
function readPackageTarball(gzipped) {
  const tar = zlib.gunzipSync(gzipped);
  const files = new Map();
  let paxPath;
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, length) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .split('\0')[0];
    const size = parseInt(text(124, 12).trim() || '0', 8);
    const type = text(156, 1) || '0';
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))?.[1] ?? paxPath;
      continue;
    }
    if (type === 'g') continue;
    const prefix = text(257, 5) === 'ustar' ? text(345, 155) : '';
    const name = paxPath ?? (prefix ? `${prefix}/${text(0, 100)}` : text(0, 100));
    paxPath = undefined;
    if (type === '5') continue;
    if (type !== '0') throw new Error(`Unsupported entry in the browser tools package: ${name}`);
    const relative = name.replace(/^package\//, '');
    if (
      relative === name ||
      /[\\:]/.test(relative) ||
      relative.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error(`Unsafe path in the browser tools package: ${name}`);
    files.set(relative, Buffer.from(body));
  }
  return files;
}

/** Re-hash every shipped file; returns the absolute entry script. */
function verifyBrowserMcp(bundle, pin) {
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
  if (manifest.name !== pin.name || manifest.version !== pin.version || manifest.integrity !== pin.integrity)
    throw new Error('Bundled browser tools manifest differs');
  const root = path.resolve(bundle, pin.name);
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid browser tools manifest path');
    if (sha256(fs.readFileSync(file)) !== expected) throw new Error(`Bundled browser tools file differs: ${relative}`);
  }
  if (!manifest.files[manifest.entry]) throw new Error('Bundled browser tools entry is missing');
  return path.resolve(root, manifest.entry);
}

async function prepareBrowserMcp({ projectRoot, fetchBytes }) {
  const pin = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).bundledBrowserMcp;
  if (!(pin?.integrity ?? '').startsWith('sha512-'))
    throw new Error('Pin the browser tools package with its sha512 integrity');
  const bundle = path.join(projectRoot, 'resources', 'bundled-browser-mcp');
  try {
    return verifyBrowserMcp(bundle, pin);
  } catch {
    /* Rebuild missing or corrupt payloads. */
  }
  const download =
    fetchBytes ??
    (async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`Browser tools download failed: HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    });
  const errors = [];
  for (const origin of ORIGINS) {
    const url = `${origin}/${pin.name}/-/${pin.name}-${pin.version}.tgz`;
    try {
      const bytes = await download(url);
      if (integrityOf(bytes) !== pin.integrity) throw new Error('Browser tools download integrity differs');
      const files = readPackageTarball(bytes);
      const metadata = JSON.parse(files.get('package.json')?.toString('utf8') ?? '{}');
      if (metadata.name !== pin.name || metadata.version !== pin.version)
        throw new Error('Browser tools package identity differs');
      const bin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.[pin.name];
      const entry = path.posix.normalize(String(bin ?? ''));
      if (!files.has(entry)) throw new Error('Browser tools package has no executable entry');
      fs.mkdirSync(path.dirname(bundle), { recursive: true });
      const stage = fs.mkdtempSync(`${bundle}.`);
      try {
        for (const [relative, body] of files) {
          const target = path.join(stage, pin.name, ...relative.split('/'));
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, body);
        }
        const hashes = Object.fromEntries([...files].map(([relative, body]) => [relative, sha256(body)]));
        fs.writeFileSync(
          path.join(stage, 'manifest.json'),
          JSON.stringify({ ...pin, url, entry, files: hashes }, null, 2)
        );
        fs.rmSync(bundle, { recursive: true, force: true });
        fs.renameSync(stage, bundle);
      } finally {
        fs.rmSync(stage, { recursive: true, force: true });
      }
      return verifyBrowserMcp(bundle, pin);
    } catch (error) {
      errors.push(error);
    }
  }
  throw new AggregateError(errors, 'Cannot prepare the verified browser tools');
}

module.exports = { prepareBrowserMcp, verifyBrowserMcp, readPackageTarball };

if (require.main === module) {
  prepareBrowserMcp({ projectRoot: path.resolve(__dirname, '../../..') })
    .then((entry) => console.log(`browser tools -> ${entry}`))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
