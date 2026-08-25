/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_UI_LANGUAGE } from './constants';

/**
 * Resolves the UI language to start in, given whatever the caller could find
 * in persisted settings.
 *
 * NexWork ships to a Simplified Chinese audience, so a fresh install starts in
 * `zh-CN` rather than following the OS locale (which is what upstream AionUi
 * does). This must only ever apply to users who have never picked a language:
 * an explicit choice is stored under the `language` config key and is passed in
 * here as `stored`, and it always wins — including when the user explicitly
 * picked `en-US`.
 *
 * Blank/whitespace-only stored values are treated as "never chosen"; they occur
 * when a config write is interrupted, and honouring them would leave i18next
 * with an empty language.
 */
export function resolveInitialLanguage(stored: string | null | undefined): string {
  if (typeof stored === 'string' && stored.trim() !== '') return stored;
  return DEFAULT_UI_LANGUAGE;
}
