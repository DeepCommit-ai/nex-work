/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BRAND_NAME, LEGACY_BRAND_PATTERN } from './constants';

/**
 * Spans of a translation string whose contents must survive verbatim, even when
 * they contain the upstream product name.
 *
 * Rewriting inside any of these silently corrupts a value rather than rebranding
 * it: a URL stops resolving, a path stops pointing at the directory that exists
 * on disk (and `<appData>/AionUi` is a contract we deliberately kept), and an
 * i18next placeholder stops matching the key the caller interpolates.
 *
 * Order matters — placeholders and URLs are matched before the general
 * "contains a separator" path rule so they win on overlapping input.
 */
const PROTECTED_SPANS = new RegExp(
  [
    /\{\{[^{}]*\}\}/, // i18next interpolation: {{AionUiPath}}
    /\$\{[^{}]*\}/, // template placeholder: ${AionUiDir}
    /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s'"`]+/, // any URL scheme: https://, file://, aionui://
    /[A-Za-z]:[\\/][^\s'"`]*/, // Windows absolute path: C:\...\AionUi
    /[^\s'"`]*[\\/][^\s'"`]*/, // anything else carrying a path separator
  ]
    .map((part) => part.source)
    .join('|'),
  'g'
);

/** Half-open [start, end) offsets of every protected span in `value`. */
function protectedRanges(value: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  PROTECTED_SPANS.lastIndex = 0;
  for (let match = PROTECTED_SPANS.exec(value); match !== null; match = PROTECTED_SPANS.exec(value)) {
    if (match[0].length === 0) {
      PROTECTED_SPANS.lastIndex += 1; // never spin on a zero-width match
      continue;
    }
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/** Rewrites the brand in `value`, leaving URLs, paths and placeholders alone. */
function brandString(value: string): string {
  // Reset lastIndex: LEGACY_BRAND_PATTERN is a shared /g regex.
  LEGACY_BRAND_PATTERN.lastIndex = 0;
  if (!LEGACY_BRAND_PATTERN.test(value)) return value;

  const ranges = protectedRanges(value);
  LEGACY_BRAND_PATTERN.lastIndex = 0;
  const next = value.replace(LEGACY_BRAND_PATTERN, (match, offset: number) => {
    const isProtected = ranges.some(([start, end]) => offset < end && offset + match.length > start);
    return isProtected ? match : BRAND_NAME;
  });
  return next === value ? value : next;
}

/**
 * Rewrites inherited upstream product names inside a loaded i18n resource tree.
 *
 * Hooking the i18n *load* path instead of editing locale JSON keeps all 13
 * locale directories byte-identical to upstream — 1163 `AionUi` occurrences
 * across 91 files stay untouched — so `scripts/check-i18n.js` and the generated
 * key types keep passing, upstream re-syncs of `locales/` merge cleanly, and
 * brand strings upstream adds later are rebranded automatically instead of
 * silently reintroducing "AionUi".
 *
 * Only prose is rewritten; see `PROTECTED_SPANS` for what is deliberately left
 * verbatim. Keys are never rewritten — several are wire contracts with the
 * AionCore backend (`AIONUI_*` error codes).
 *
 * Subtrees with no brand string are returned by reference, so a locale bundle
 * is not deep-cloned just to walk it.
 */
export function applyBrandToTranslations<T>(node: T): T {
  if (typeof node === 'string') {
    return brandString(node) as unknown as T;
  }

  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const branded = applyBrandToTranslations(item);
      if (branded !== item) changed = true;
      return branded;
    });
    return changed ? (next as unknown as T) : node;
  }

  if (typeof node === 'object' && node !== null) {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const branded = applyBrandToTranslations(value);
      if (branded !== value) changed = true;
      next[key] = branded;
    }
    return changed ? (next as unknown as T) : node;
  }

  return node;
}
