/** Give the backend the packaged Office preview binary without changing the user's PATH. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type OfficePin = { version: string; assets: Record<string, { name: string; sha256: string }> };

export function officeRuntimeEnvironment(
  resources: string,
  pin: OfficePin,
  platform = process.platform,
  arch = process.arch,
  env: NodeJS.ProcessEnv = process.env,
  required = true
): Record<string, string> {
  const asset = pin.assets[`${platform}-${arch}`];
  if (!asset) throw new Error(`Unsupported Office preview platform: ${platform}-${arch}`);
  const directory = path.join(resources, 'bundled-officecli', `${platform}-${arch}`);
  const binary = path.join(directory, platform === 'win32' ? 'officecli.exe' : 'officecli');
  if (!required && !existsSync(binary)) return {};
  if (createHash('sha256').update(readFileSync(binary)).digest('hex') !== asset.sha256)
    throw new Error('Bundled Office preview checksum differs; reinstall this application');
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')) as { version: string };
  if (manifest.version !== pin.version) throw new Error('Bundled Office preview version differs');
  const keys = Object.keys(env).filter((key) => (platform === 'win32' ? key.toUpperCase() === 'PATH' : key === 'PATH'));
  const delimiter = platform === 'win32' ? ';' : ':';
  const value = [directory, env[keys[0] ?? 'PATH'] ?? ''].filter(Boolean).join(delimiter);
  return Object.fromEntries((keys.length ? keys : ['PATH']).map((key) => [key, value]));
}
