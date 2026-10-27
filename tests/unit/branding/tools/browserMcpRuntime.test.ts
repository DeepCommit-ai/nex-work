import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { BUNDLED_BROWSER_MCP_ENV, browserMcpRuntimeEnvironment } from '@/branding/tools/browserMcpRuntime';

const require = createRequire(import.meta.url);
const {
  prepareBrowserMcp,
  verifyBrowserMcp,
} = require('../../../../packages/shared-scripts/src/prepare-browser-mcp.js');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const block = (body: Buffer) => Buffer.concat([body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
function entry(name: string, body: Buffer, type = '0'): Buffer {
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 100), 0);
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write(type, 156);
  header.write('ustar\0', 257);
  return Buffer.concat([header, block(body)]);
}
/** A pax header carries a path longer than ustar's 100-byte name field. */
function paxEntry(name: string, body: Buffer): Buffer {
  const rest = ` path=${name}\n`;
  let length = rest.length;
  while (`${length}${rest}`.length !== length) length = `${length}${rest}`.length;
  return Buffer.concat([entry('PaxHeader', Buffer.from(`${length}${rest}`), 'x'), entry(name.slice(-90), body)]);
}
const tgz = (...entries: Buffer[]) => gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
const integrity = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

const longPath = `package/build/node_modules/${'deep/'.repeat(25)}module.js`;
const packageTarball = tgz(
  entry('package/', Buffer.alloc(0), '5'),
  entry(
    'package/package.json',
    Buffer.from(JSON.stringify({ name: 'chrome-devtools-mcp', version: '1.2.3', bin: './build/src/index.js' }))
  ),
  entry('package/build/src/index.js', Buffer.from('#!/usr/bin/env node\n')),
  paxEntry(longPath, Buffer.from('export {};\n'))
);
const pinFor = (bytes: Buffer) => ({ name: 'chrome-devtools-mcp', version: '1.2.3', integrity: integrity(bytes) });

function fixture(bytes = packageTarball) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'browser-mcp-'));
  roots.push(root);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ bundledBrowserMcp: pinFor(bytes) }));
  return root;
}

describe('bundled browser tools (spec 019)', () => {
  it('downloads the pinned tarball, retries the mirror, and reuses a verified bundle offline', async () => {
    const root = fixture();
    const urls: string[] = [];
    const entryPath = await prepareBrowserMcp({
      projectRoot: root,
      fetchBytes: async (url: string) => {
        urls.push(url);
        if (urls.length === 1) throw new Error('registry unreachable');
        return packageTarball;
      },
    });
    expect(urls).toEqual([
      'https://registry.npmjs.org/chrome-devtools-mcp/-/chrome-devtools-mcp-1.2.3.tgz',
      'https://registry.npmmirror.com/chrome-devtools-mcp/-/chrome-devtools-mcp-1.2.3.tgz',
    ]);
    const bundle = path.join(root, 'resources', 'bundled-browser-mcp');
    expect(entryPath).toBe(path.join(bundle, 'chrome-devtools-mcp', 'build', 'src', 'index.js'));
    expect(readFileSync(path.join(bundle, 'chrome-devtools-mcp', ...longPath.split('/').slice(1)), 'utf8')).toBe(
      'export {};\n'
    );
    const offline = async () => {
      throw new Error('offline');
    };
    await expect(prepareBrowserMcp({ projectRoot: root, fetchBytes: offline })).resolves.toBe(entryPath);
  });

  it('rejects a download whose integrity differs from the pin and installs nothing', async () => {
    const root = fixture();
    await expect(
      prepareBrowserMcp({ projectRoot: root, fetchBytes: async () => tgz(entry('package/x.js', Buffer.from('1'))) })
    ).rejects.toThrow('Cannot prepare');
    expect(existsSync(path.join(root, 'resources', 'bundled-browser-mcp'))).toBe(false);
  });

  it('refuses tarball entries that escape the package directory', async () => {
    const evil = tgz(
      entry(
        'package/package.json',
        Buffer.from(JSON.stringify({ name: 'chrome-devtools-mcp', version: '1.2.3', bin: 'a.js' }))
      ),
      entry('package/../escaped.js', Buffer.from('pwned'))
    );
    const root = fixture(evil);
    await expect(prepareBrowserMcp({ projectRoot: root, fetchBytes: async () => evil })).rejects.toThrow(
      'Cannot prepare'
    );
    expect(existsSync(path.join(root, 'resources', 'escaped.js'))).toBe(false);
  });

  it('detects a file changed after preparation before it can ship', async () => {
    const root = fixture();
    const entryPath = await prepareBrowserMcp({ projectRoot: root, fetchBytes: async () => packageTarball });
    writeFileSync(entryPath, 'tampered');
    expect(() => verifyBrowserMcp(path.join(root, 'resources', 'bundled-browser-mcp'), pinFor(packageTarball))).toThrow(
      'differs'
    );
  });

  it('points the backend at the shipped entry', async () => {
    const root = fixture();
    const entryPath = await prepareBrowserMcp({ projectRoot: root, fetchBytes: async () => packageTarball });
    expect(browserMcpRuntimeEnvironment(path.join(root, 'resources'), pinFor(packageTarball))).toEqual({
      [BUNDLED_BROWSER_MCP_ENV]: entryPath,
    });
  });

  it('leaves unprepared development checkouts on npx', () => {
    expect(browserMcpRuntimeEnvironment(fixture(), pinFor(packageTarball), false)).toEqual({});
  });

  it('never points a packaged build at a bundle of another version', async () => {
    const root = fixture();
    await prepareBrowserMcp({ projectRoot: root, fetchBytes: async () => packageTarball });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      browserMcpRuntimeEnvironment(path.join(root, 'resources'), { ...pinFor(packageTarball), version: '9.9.9' })
    ).toEqual({});
    expect(error).toHaveBeenCalledOnce();
  });

  it('pins the version the launcher would otherwise fetch with npx', () => {
    const repo = path.resolve(__dirname, '../../../..');
    const pin = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).bundledBrowserMcp;
    const launcher = readFileSync(
      path.join(repo, 'packages/desktop/src/process/resources/builtinMcp/browserServer.ts'),
      'utf8'
    );
    expect(launcher).toContain(`CHROME_DEVTOOLS_MCP_VERSION = '${pin.version}'`);
    expect(pin.name).toBe('chrome-devtools-mcp');
  });
});
