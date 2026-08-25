/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Process-agnostic entry point for the NexWork branding layer.
 *
 * Only DOM-free, Node-free exports belong here: this barrel is imported from
 * the main process as well as the renderer. `BrandMark.tsx` (React) and
 * `brand-override.css` are renderer-only and must be imported by path.
 */

export {
  BRAND_NAME,
  LEGACY_BRAND_PATTERN,
  LEGACY_APP_DATA_DIR_NAME,
  AUTO_UPDATE_ENABLED,
  DEFAULT_UI_LANGUAGE,
  BRAND_COLOR_INK,
  BRAND_COLOR_CREAM,
} from './constants';
export { applyBrandToTranslations } from './translations';
export { resolveInitialLanguage } from './language';
