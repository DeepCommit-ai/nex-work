/** Prepare the pinned Office preview runtime at build time, never on an employee machine. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const binaryName = (platform) => (platform === 'win32' ? 'officecli.exe' : 'officecli');

function verifyOfficecli(bundle, pin, platform, arch) {
  const expected = pin.assets[`${platform}-${arch}`];
  if (!expected) throw new Error(`Unsupported Office preview platform: ${platform}-${arch}`);
  const file = path.join(bundle, binaryName(platform));
  if (hash(fs.readFileSync(file)) !== expected.sha256) throw new Error('Bundled Office preview checksum differs');
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
  if (manifest.version !== pin.version || manifest.sha256 !== expected.sha256)
    throw new Error('Bundled Office preview manifest differs');
  return file;
}

async function prepareOfficecli({ projectRoot, platform = process.platform, arch = process.arch, fetchBytes }) {
  const pin = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).bundledOffice;
  const asset = pin.assets[`${platform}-${arch}`];
  if (!asset) throw new Error(`Unsupported Office preview platform: ${platform}-${arch}`);
  const bundle = path.join(projectRoot, 'resources', 'bundled-officecli', `${platform}-${arch}`);
  try {
    return verifyOfficecli(bundle, pin, platform, arch);
  } catch {
    /* Rebuild missing or corrupt payloads. */
  }
  const download =
    fetchBytes ??
    (async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`Office preview download failed: HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    });
  const errors = [];
  for (const origin of ['https://d.officecli.ai', 'https://github.com/iOfficeAI/OfficeCLI']) {
    const url = `${origin}/releases/download/v${pin.version}/${asset.name}`;
    try {
      const bytes = await download(url);
      if (hash(bytes) !== asset.sha256) throw new Error('Office preview download checksum differs');
      fs.mkdirSync(bundle, { recursive: true });
      const target = path.join(bundle, binaryName(platform));
      const staging = `${target}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(staging, bytes, { flag: 'wx', mode: 0o755 });
        fs.renameSync(staging, target);
      } finally {
        if (fs.existsSync(staging)) fs.unlinkSync(staging);
      }
      fs.writeFileSync(
        path.join(bundle, 'manifest.json'),
        JSON.stringify({ version: pin.version, sha256: asset.sha256, url })
      );
      return verifyOfficecli(bundle, pin, platform, arch);
    } catch (error) {
      errors.push(error);
    }
  }
  throw new AggregateError(errors, 'Cannot prepare the verified Office preview runtime');
}

module.exports = { prepareOfficecli, verifyOfficecli };
