/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';

/** Minimal surface of Electron's `nativeImage` that this module needs. */
export type TrayImageFactory = {
  createFromPath: (p: string) => {
    isEmpty: () => boolean;
    setTemplateImage: (value: boolean) => void;
    resize: (options: { width: number; height: number }) => unknown;
  };
};

/** Filenames are a contract with the generator, not a free choice. */
export const TRAY_TEMPLATE_FILENAME = 'trayTemplate.png';

/**
 * Builds the macOS menu-bar tray image.
 *
 * The menu bar wants a *template* image: alpha-only artwork that macOS recolours
 * for the light or dark bar. Handing it the full-colour app icon — which upstream
 * does, despite a comment claiming otherwise — puts a 16px cream tile in the menu
 * bar with the mark too small to read. This returns the glyph-only template
 * instead, and Electron picks up `trayTemplate@2x.png` automatically on Retina.
 *
 * Returns null on non-macOS platforms, and on macOS when the asset is missing, so
 * the caller keeps its existing behaviour rather than showing an empty tray.
 */
export function createBrandTrayImage(
  nativeImage: TrayImageFactory,
  resourcesPath: string,
  platform: NodeJS.Platform
): unknown | null {
  if (platform !== 'darwin') return null;
  const image = nativeImage.createFromPath(path.join(resourcesPath, TRAY_TEMPLATE_FILENAME));
  if (image.isEmpty()) return null;
  image.setTemplateImage(true);
  return image.resize({ width: 16, height: 16 });
}
