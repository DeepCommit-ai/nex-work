/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import brandIcon from '@renderer/assets/logos/brand/app.png';

type BrandMarkProps = {
  className?: string;
};

/**
 * The NexWork brand mark, as shown inside the app.
 *
 * This renders the **app icon asset itself** rather than a hand-drawn SVG. The
 * icon is a composition — cream field, ink panel, glyph — and the cream field is
 * part of the design, so an SVG of the glyph alone was not the brand mark, just
 * a piece of it. Using the asset also means there is one source of truth: when
 * `scripts/generate-brand-icons.mjs` regenerates the icons, this follows
 * automatically instead of drifting.
 *
 * `brand-override.css` sizes it to fill the chip upstream draws around it, and
 * clears that chip's background, since the icon supplies its own.
 */
const BrandMark: React.FC<BrandMarkProps> = ({ className }) => (
  <img
    src={brandIcon}
    className={className ? `nexwork-brand-mark ${className}` : 'nexwork-brand-mark'}
    alt=''
    aria-hidden='true'
    draggable={false}
  />
);

export default BrandMark;
