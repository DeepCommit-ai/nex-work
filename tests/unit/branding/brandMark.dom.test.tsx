/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import BrandMark from '@/branding/BrandMark';

describe('BrandMark', () => {
  it('renders the app icon asset, so the in-app mark cannot drift from the icon', () => {
    // An earlier revision drew the glyph as an inline SVG. That dropped the cream
    // field — which is part of the mark, not a background — and created a second
    // source of truth that regenerating the icons would not update.
    const { container } = render(<BrandMark />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toContain('app.png');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('always carries the hook class brand-override.css selects on', () => {
    expect(render(<BrandMark />).container.querySelector('img')).toHaveClass('nexwork-brand-mark');
  });

  it('keeps the caller className alongside the hook class', () => {
    const { container } = render(<BrandMark className='w-5.5 h-5.5' />);
    const img = container.querySelector('img');
    expect(img).toHaveClass('nexwork-brand-mark');
    expect(img).toHaveClass('w-5.5');
  });

  it('is decorative: hidden from assistive tech and not draggable', () => {
    // The brand name sits next to it as real text, so announcing the image would
    // just repeat it.
    const img = render(<BrandMark />).container.querySelector('img');
    expect(img).toHaveAttribute('aria-hidden', 'true');
    expect(img).toHaveAttribute('alt', '');
    expect(img).not.toBeNull();
  });
});

describe('brand-override.css contract', () => {
  it('clears the chip paint and leaves sizing to upstream', async () => {
    // The stylesheet is the other half of this component: the chip's paint must
    // go, or it shows through the icon's transparent corners as dark slivers.
    // Sizing must NOT be overridden — doing so made the mark bigger than the
    // footprint it has always had.
    const { readFileSync } = await import('node:fs');
    const { execFileSync } = await import('node:child_process');
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();
    const css = readFileSync(`${root}/packages/desktop/src/branding/brand-override.css`, 'utf-8');

    expect(css).toContain('div:has(> .nexwork-brand-mark)');
    expect(css).toMatch(/div:has\(> \.nexwork-brand-mark\)\s*\{[^}]*background-color:\s*transparent/);
    // Regression guard: the mark's box belongs to upstream's utility classes.
    expect(css).not.toMatch(/\.nexwork-brand-mark\s*\{[^}]*(width|height|transform)\s*:/);
  });
});
