/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createBrandTrayImage, TRAY_TEMPLATE_FILENAME, type TrayImageFactory } from '@/branding/trayIcon';

const projectRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();

/** Fake `nativeImage` that records what the tray code did to the image. */
function createFactory(options: { empty?: boolean } = {}) {
  const setTemplateImage = vi.fn();
  const resize = vi.fn((size: { width: number; height: number }) => ({ resizedTo: size }));
  const paths: string[] = [];
  const nativeImage: TrayImageFactory = {
    createFromPath: (p: string) => {
      paths.push(p);
      return { isEmpty: () => options.empty === true, setTemplateImage, resize };
    },
  };
  return { nativeImage, setTemplateImage, resize, paths };
}

describe('createBrandTrayImage', () => {
  it('returns a template image on macOS, so the menu bar recolours it per theme', () => {
    const f = createFactory();
    const image = createBrandTrayImage(f.nativeImage, '/res', 'darwin');

    expect(image).not.toBeNull();
    // Without this the menu bar draws the artwork as-is: at 16px the cream field
    // swamps the mark and nothing is legible.
    expect(f.setTemplateImage).toHaveBeenCalledWith(true);
    expect(f.resize).toHaveBeenCalledWith({ width: 16, height: 16 });
    expect(f.paths).toEqual([path.join('/res', TRAY_TEMPLATE_FILENAME)]);
  });

  it.each(['win32', 'linux'] as const)('returns null on %s so the caller keeps its own icon', (platform) => {
    const f = createFactory();
    expect(createBrandTrayImage(f.nativeImage, '/res', platform)).toBeNull();
    expect(f.setTemplateImage).not.toHaveBeenCalled();
  });

  it('returns null rather than an empty image when the asset is missing', () => {
    // A missing extraResources entry must degrade to the old icon, not to a
    // blank square in the menu bar.
    const f = createFactory({ empty: true });
    expect(createBrandTrayImage(f.nativeImage, '/res', 'darwin')).toBeNull();
    expect(f.setTemplateImage).not.toHaveBeenCalled();
  });
});

describe('tray template packaging', () => {
  it('ships both template files, because extraResources is an explicit allow-list', () => {
    // `resources/` is not copied wholesale — each file is named individually, so
    // an unlisted asset is missing in packaged builds only, where it is hardest
    // to notice.
    const yml = readFileSync(path.join(projectRoot, 'packages/desktop/electron-builder.yml'), 'utf-8');
    expect(yml).toContain('from: resources/trayTemplate.png');
    expect(yml).toContain('to: trayTemplate.png');
    expect(yml).toContain('from: resources/trayTemplate@2x.png');
    expect(yml).toContain('to: trayTemplate@2x.png');
  });
});
