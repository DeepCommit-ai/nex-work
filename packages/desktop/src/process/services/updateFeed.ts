/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { CdnGenericProvider } from './cdnGenericProvider';
import type { CdnGenericProviderConfiguration } from './cdnGenericProvider';

// NOTE: this is UPSTREAM AionUi's feed. NexWork ships with updates disabled
// (`AUTO_UPDATE_ENABLED` in src/branding/constants.ts), so nothing reads this
// today. Repoint it at the company feed before flipping that flag back on.
export const CDN_UPDATE_BASE_URL = 'https://static.aionui.com/releases';

export type CdnFeedOptions = CdnGenericProviderConfiguration & {
  updateProvider: typeof CdnGenericProvider;
};

export function buildCdnFeedOptions(): CdnFeedOptions {
  return {
    provider: 'custom',
    url: CDN_UPDATE_BASE_URL,
    updateProvider: CdnGenericProvider,
  };
}
