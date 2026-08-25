/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_UI_LANGUAGE, resolveInitialLanguage } from '@/branding';
import { SUPPORTED_LANGUAGES, normalizeLanguageCode } from '@/common/config/i18n';

describe('resolveInitialLanguage', () => {
  it('starts a brand-new install in Simplified Chinese', () => {
    // Nothing persisted yet — this is the only case the NexWork default applies to.
    expect(resolveInitialLanguage(undefined)).toBe('zh-CN');
    expect(resolveInitialLanguage(null)).toBe('zh-CN');
  });

  it('never clobbers a language the user explicitly chose', () => {
    // Including English: an explicit en-US must not be re-defaulted to zh-CN.
    expect(resolveInitialLanguage('en-US')).toBe('en-US');
    expect(resolveInitialLanguage('ja-JP')).toBe('ja-JP');
    expect(resolveInitialLanguage('fa-IR')).toBe('fa-IR');
  });

  it('preserves an explicit choice for every supported language', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      expect(resolveInitialLanguage(language)).toBe(language);
    }
  });

  it('treats a blank stored value as never chosen', () => {
    // An interrupted config write can leave '' behind; honouring it would hand
    // i18next an empty language.
    expect(resolveInitialLanguage('')).toBe(DEFAULT_UI_LANGUAGE);
    expect(resolveInitialLanguage('   ')).toBe(DEFAULT_UI_LANGUAGE);
  });

  it('leaves normalisation of unknown tags to the i18n layer', () => {
    // The helper only decides "stored or default"; it must not silently drop a
    // value the normaliser would still map to a supported locale.
    expect(resolveInitialLanguage('zh_TW')).toBe('zh_TW');
    expect(normalizeLanguageCode(resolveInitialLanguage('zh_TW'))).toBe('zh-TW');
  });

  it('defaults to a language the app can actually load', () => {
    expect(SUPPORTED_LANGUAGES).toContain(DEFAULT_UI_LANGUAGE);
    expect(normalizeLanguageCode(DEFAULT_UI_LANGUAGE)).toBe(DEFAULT_UI_LANGUAGE);
  });
});
