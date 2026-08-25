/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * NexWork ships with auto-update off.
 *
 * The updater it inherits from upstream targets upstream's channel
 * (`https://static.aionui.com/releases` plus the iOfficeAI/AionUi GitHub
 * releases), so a packaged NexWork left with updates on could download an
 * upstream AionUi build and replace itself with it.
 *
 * The renderer half of this ("nothing is offered") is asserted by rendering the
 * About panel in tests/unit/settings/AboutModalContent.dom.test.tsx. The main
 * process half cannot be rendered, so it is asserted at source level — these
 * read src/index.ts rather than booting Electron.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTO_UPDATE_ENABLED } from '@/branding';

const projectRoot = resolve(__dirname, '../../..');
const readSource = (rel: string): string => readFileSync(resolve(projectRoot, rel), 'utf8');

describe('auto-update disablement', () => {
  it('is off in the shipped configuration', () => {
    expect(AUTO_UPDATE_ENABLED).toBe(false);
  });

  it('gates the main-process updater on the branding flag', () => {
    // Without this the service initialises and schedules a background check
    // against upstream's feed three seconds after launch.
    const source = readSource('packages/desktop/src/index.ts');
    const guard = source.match(/const disableAutoUpdater =[\s\S]*?;/)?.[0];
    expect(guard).toBeDefined();
    expect(guard).toContain('!AUTO_UPDATE_ENABLED');
  });

  it('does not mount the update notification card while disabled', () => {
    const source = readSource('packages/desktop/src/renderer/components/layout/Layout.tsx');
    expect(source).toContain('{AUTO_UPDATE_ENABLED && (');
  });

  it('does not publish auto-update metadata to upstream’s channel', () => {
    const config = readSource('packages/desktop/electron-builder.yml');
    expect(config).toContain('publishAutoUpdate: false');
  });

  it('leaves upstream’s updater code in place so re-enabling is one flag', () => {
    // Deleting it would make wiring a company feed a re-implementation.
    const feed = readSource('packages/desktop/src/process/services/updateFeed.ts');
    expect(feed).toContain('buildCdnFeedOptions');
    expect(feed).toContain('CDN_UPDATE_BASE_URL');
  });

  it('points the next maintainer at the feed decision', () => {
    // The flag is useless if whoever flips it does not know the URL is upstream's.
    expect(readSource('packages/desktop/src/branding/constants.ts')).toContain('TO RE-ENABLE');
    expect(readSource('packages/desktop/src/process/services/updateFeed.ts')).toContain('AUTO_UPDATE_ENABLED');
  });
});
