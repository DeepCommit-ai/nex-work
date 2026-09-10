import { describe, expect, it } from 'vitest';
import {
  backendTarget,
  backendBuildKey,
  buildWorkspaceBackend,
} from '../../../../packages/desktop/src/branding/tools/backendWorkspace.mjs';

describe('branded backend preparation', () => {
  it('selects supported macOS and Windows architecture targets', () => {
    expect(backendTarget('darwin', 'arm64')).toBe('aarch64-apple-darwin');
    expect(backendTarget('win32', 'x64')).toBe('x86_64-pc-windows-msvc');
    expect(backendTarget('win32', 'arm64')).toBe('aarch64-pc-windows-msvc');
  });
  it('rejects unsupported targets and unreviewed upgrades', () => {
    expect(() => backendTarget('darwin', 'ia32')).toThrow('Unsupported');
    expect(() => buildWorkspaceBackend({ version: 'v9.0.0' })).toThrow('Review');
  });
  it('invalidates binary caches when the patch or architecture changes', () => {
    expect(backendBuildKey('aarch64-apple-darwin', 'patch A')).not.toBe(
      backendBuildKey('aarch64-apple-darwin', 'patch B')
    );
    expect(backendBuildKey('aarch64-apple-darwin', 'patch A')).not.toBe(
      backendBuildKey('x86_64-apple-darwin', 'patch A')
    );
  });
});
