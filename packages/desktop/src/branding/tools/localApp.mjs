/** Build an isolated macOS development launcher; never patch node_modules in place. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export function localBundleMetadata(plist) {
  const values = {
    CFBundleName: 'NexWork',
    CFBundleDisplayName: 'NexWork',
    CFBundleExecutable: 'NexWork',
    CFBundleIdentifier: 'ai.deepcommit.nexwork.local',
    CFBundleIconFile: 'nexwork.icns',
  };
  let result = plist;
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
    result = pattern.test(result)
      ? result.replace(pattern, `$1${value}$2`)
      : result.replace(/<\/dict>\s*<\/plist>\s*$/, `<key>${key}</key><string>${value}</string>\n</dict></plist>`);
  }
  return result;
}

/** A renamed Electron bundle is detected as packaged; explicitly keep this launcher in development mode. */
export function localAppBootstrap(root) {
  return `const { app } = require('electron');
Object.defineProperty(app, 'isPackaged', { value: false });
app.setAppPath(${JSON.stringify(root)});
app.setVersion(require(${JSON.stringify(path.join(root, 'package.json'))}).version);
require(${JSON.stringify(path.join(root, 'out/main/index.js'))});
`;
}

/** Return a branded executable using the same repository and development data directory. */
export function prepareLocalApp(root) {
  if (process.platform !== 'darwin')
    throw new Error('The branded local launcher currently requires macOS; use the NexWork installer on Windows.');
  const electron = path.join(root, 'node_modules/electron/dist/Electron.app');
  const input = fs.readFileSync(path.join(electron, 'Contents/Info.plist'), 'utf8');
  const icon = path.join(root, 'resources/app.icns');
  const metadata = localBundleMetadata(input);
  const version = fs.readFileSync(path.join(root, 'node_modules/electron/dist/version'), 'utf8');
  const hash = createHash('sha256')
    .update(version)
    .update(metadata)
    .update(fs.readFileSync(icon))
    .digest('hex')
    .slice(0, 16);
  const destination = path.join(root, '.analysis', 'local-launcher', hash, 'NexWork.app');
  const executablePath = path.join(destination, 'Contents/MacOS/NexWork');
  const ready = path.join(destination, 'Contents/Resources/nexwork-ready');
  if (!fs.existsSync(ready)) {
    if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(electron, destination, { recursive: true, verbatimSymlinks: true });
    fs.writeFileSync(path.join(destination, 'Contents/Info.plist'), metadata);
    fs.renameSync(path.join(destination, 'Contents/MacOS/Electron'), executablePath);
    fs.copyFileSync(icon, path.join(destination, 'Contents/Resources/nexwork.icns'));
    fs.writeFileSync(ready, hash);
    try {
      execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', destination], { stdio: 'pipe' });
    } catch (error) {
      fs.rmSync(ready, { force: true });
      throw error;
    }
  }
  const bootstrap = path.join(path.dirname(destination), 'launch.cjs');
  fs.writeFileSync(bootstrap, localAppBootstrap(root));
  return { executablePath, cwd: root, args: [bootstrap] };
}
