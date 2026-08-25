/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { BRAND_NAME, applyBrandToTranslations } from '@/branding';

describe('applyBrandToTranslations', () => {
  it('rewrites every upstream spelling of the product name', () => {
    // Locale JSON inherited from upstream mixes all three spellings.
    expect(applyBrandToTranslations('Show AionUi')).toBe(`Show ${BRAND_NAME}`);
    expect(applyBrandToTranslations('restart AionUI')).toBe(`restart ${BRAND_NAME}`);
    expect(applyBrandToTranslations('Aion UI is ready')).toBe(`${BRAND_NAME} is ready`);
  });

  it('rewrites every occurrence in a string, not just the first', () => {
    expect(applyBrandToTranslations('AionUi opened, but AionUi cannot start')).toBe(
      `${BRAND_NAME} opened, but ${BRAND_NAME} cannot start`
    );
  });

  it('preserves i18next interpolation placeholders around the brand', () => {
    expect(applyBrandToTranslations('This AionUi package is for {{packageArch}}')).toBe(
      `This ${BRAND_NAME} package is for {{packageArch}}`
    );
  });

  it('rewrites values nested in objects and arrays but never the keys', () => {
    const input = {
      tray: { about: 'About AionUi' },
      steps: ['Install AionUi', 'Restart AionUi'],
      AIONUI_STREAM_BROKEN: { title: 'AionUi lost the stream' },
    };

    const result = applyBrandToTranslations(input);

    expect(result.tray.about).toBe(`About ${BRAND_NAME}`);
    expect(result.steps).toEqual([`Install ${BRAND_NAME}`, `Restart ${BRAND_NAME}`]);
    // Error-code keys are an AionCore wire contract and must survive verbatim.
    expect(Object.keys(result)).toContain('AIONUI_STREAM_BROKEN');
  });

  it('leaves backend contract strings that only look brand-like untouched', () => {
    // Data dirs, config keys, protocol scheme and env vars are contracts with
    // the aioncore backend — the pattern must not match their lowercase forms.
    const contracts = ['~/.aionui-dev', 'aionui.dir', 'aionui://open', 'AIONUI_BACKEND_BIN', 'com.aionui.app'];
    for (const value of contracts) {
      expect(applyBrandToTranslations(value)).toBe(value);
    }
  });

  it('returns the original reference when nothing in the subtree changed', () => {
    // Avoids deep-cloning ~2000 untouched keys per locale on every load.
    const untouched = { a: { b: 'plain copy' }, c: [1, 2] };
    expect(applyBrandToTranslations(untouched)).toBe(untouched);
    expect(applyBrandToTranslations(untouched).a).toBe(untouched.a);
  });

  it('does not mutate the imported locale object it was given', () => {
    const input = { title: 'AionUi' };
    applyBrandToTranslations(input);
    expect(input.title).toBe('AionUi');
  });

  it('passes through values i18next resources can legitimately hold', () => {
    expect(applyBrandToTranslations(null)).toBeNull();
    expect(applyBrandToTranslations(undefined)).toBeUndefined();
    expect(applyBrandToTranslations(42)).toBe(42);
    expect(applyBrandToTranslations(false)).toBe(false);
    expect(applyBrandToTranslations('')).toBe('');
    expect(applyBrandToTranslations({})).toEqual({});
    expect(applyBrandToTranslations([])).toEqual([]);
  });

  describe('contract-shaped substrings are left verbatim', () => {
    it('does not rewrite the brand inside a URL', () => {
      // A rewritten host or path stops resolving — silent corruption, not a rebrand.
      expect(applyBrandToTranslations('https://static.aionui.com/AionUi/releases')).toBe(
        'https://static.aionui.com/AionUi/releases'
      );
      expect(applyBrandToTranslations('https://github.com/iOfficeAI/AionUi/issues')).toBe(
        'https://github.com/iOfficeAI/AionUi/issues'
      );
      expect(applyBrandToTranslations('aionui://open/AionUi')).toBe('aionui://open/AionUi');
    });

    it('does not rewrite the brand inside a filesystem path', () => {
      // <appData>/AionUi is the data directory the rebrand deliberately pinned.
      expect(applyBrandToTranslations('C:\\Users\\me\\AppData\\Local\\AionUi')).toBe(
        'C:\\Users\\me\\AppData\\Local\\AionUi'
      );
      expect(applyBrandToTranslations('/Users/me/Library/Application Support/AionUi')).toBe(
        '/Users/me/Library/Application Support/AionUi'
      );
      expect(applyBrandToTranslations('~/Library/Logs/AionUi-Dev')).toBe('~/Library/Logs/AionUi-Dev');
    });

    it('does not rewrite the brand inside an interpolation placeholder', () => {
      // The placeholder name must keep matching what the caller interpolates.
      expect(applyBrandToTranslations('Open {{AionUiPath}} to continue')).toBe('Open {{AionUiPath}} to continue');
      expect(applyBrandToTranslations('Run ${AionUiDir}/bin')).toBe('Run ${AionUiDir}/bin');
    });

    it('still rebrands the prose around a protected span', () => {
      // The guard must be surgical: only the contract survives, not the sentence.
      expect(applyBrandToTranslations('Reinstall AionUi from https://static.aionui.com/AionUi/releases')).toBe(
        `Reinstall ${BRAND_NAME} from https://static.aionui.com/AionUi/releases`
      );
      expect(applyBrandToTranslations('AionUi could not read {{AionUiPath}}, restart AionUi')).toBe(
        `${BRAND_NAME} could not read {{AionUiPath}}, restart ${BRAND_NAME}`
      );
    });

    it('leaves a value untouched when its only brand mention is protected', () => {
      // Returning the same reference keeps the no-clone fast path intact.
      const value = { url: 'https://static.aionui.com/AionUi/releases' };
      expect(applyBrandToTranslations(value)).toBe(value);
    });
  });

  it('is not left stateful by a previous call', () => {
    // LEGACY_BRAND_PATTERN is a shared /g regex; a leaked lastIndex would make
    // the second identical call miss the match.
    expect(applyBrandToTranslations('AionUi')).toBe(BRAND_NAME);
    expect(applyBrandToTranslations('AionUi')).toBe(BRAND_NAME);
    expect(applyBrandToTranslations({ a: 'AionUi', b: 'AionUi' })).toEqual({ a: BRAND_NAME, b: BRAND_NAME });
  });
});
