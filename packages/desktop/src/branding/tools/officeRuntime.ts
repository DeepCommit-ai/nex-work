/** Give the backend the packaged Office preview binary without changing the user's PATH. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type OfficePin = { version: string; assets: Record<string, { name: string; sha256: string }> };

/**
 * OfficeCLI replaces its own executable when a newer release appears (upstream UpdateChecker). Inside the
 * application that executable is the pinned, checksummed one, so it must never update itself (spec 019).
 */
const NO_SELF_UPDATE = { OFFICECLI_SKIP_UPDATE: '1' };

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
  if (!required && !existsSync(binary)) return NO_SELF_UPDATE;
  try {
    if (createHash('sha256').update(readFileSync(binary)).digest('hex') !== asset.sha256)
      throw new Error('Bundled Office preview checksum differs; reinstall this application');
    const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')) as { version: string };
    if (manifest.version !== pin.version) throw new Error('Bundled Office preview version differs');
  } catch (error) {
    // Never expose an unverified binary, but never stop the whole backend over it either (spec 019).
    console.error('[office-runtime] Bundled OfficeCLI unusable:', error);
    return NO_SELF_UPDATE;
  }
  const keys = Object.keys(env).filter((key) => (platform === 'win32' ? key.toUpperCase() === 'PATH' : key === 'PATH'));
  const delimiter = platform === 'win32' ? ';' : ':';
  const value = [directory, env[keys[0] ?? 'PATH'] ?? ''].filter(Boolean).join(delimiter);
  return { ...NO_SELF_UPDATE, ...Object.fromEntries((keys.length ? keys : ['PATH']).map((key) => [key, value])) };
}
