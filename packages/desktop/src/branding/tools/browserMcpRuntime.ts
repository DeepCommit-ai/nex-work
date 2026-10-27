/** Run the in-app browser tools from files shipped in the application, never from an npx download (spec 019). */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Read by builtin-mcp-browser: the shipped chrome-devtools-mcp entry it starts with its own node. */
export const BUNDLED_BROWSER_MCP_ENV = 'NEXWORK_CHROME_DEVTOOLS_MCP';

type BrowserMcpPin = { name: string; version: string; integrity: string };

/**
 * Backend environment pointing the browser tools at the bundled chrome-devtools-mcp. Build and afterPack
 * hash every file; here a damaged install only logs and falls back to npx, because the rest of the app
 * must still start.
 */
export function browserMcpRuntimeEnvironment(
  resources: string,
  pin: BrowserMcpPin,
  required = true
): Record<string, string> {
  const bundle = path.join(resources, 'bundled-browser-mcp');
  const manifestPath = path.join(bundle, 'manifest.json');
  if (!required && !existsSync(manifestPath)) return {};
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BrowserMcpPin & { entry: string };
    if (manifest.name !== pin.name || manifest.version !== pin.version || manifest.integrity !== pin.integrity)
      throw new Error(`version ${manifest.version} differs from ${pin.version}`);
    const entry = path.join(bundle, pin.name, ...manifest.entry.split('/'));
    if (!existsSync(entry)) throw new Error(`entry ${manifest.entry} is missing`);
    return { [BUNDLED_BROWSER_MCP_ENV]: entry };
  } catch (error) {
    console.error('[browser-tools] Bundled chrome-devtools-mcp unusable; falling back to npx:', error);
    return {};
  }
}
