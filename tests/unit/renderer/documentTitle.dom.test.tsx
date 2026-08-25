/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';

let mockLanguage = 'en-US';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (mockLanguage === 'zh-CN' ? `zh:${key}` : key),
    i18n: { language: mockLanguage },
  }),
}));

import DocumentTitle, { titleForPath } from '@/renderer/components/layout/DocumentTitle';
import { BRAND_NAME } from '@/branding';

describe('titleForPath', () => {
  const t = (key: string) => `t(${key})`;

  it('uses the login title on the login route only', () => {
    expect(titleForPath('/login', t)).toBe('t(login.pageTitle)');
    expect(titleForPath('/guid', t)).toBe(BRAND_NAME);
    expect(titleForPath('/conversation/abc', t)).toBe(BRAND_NAME);
    expect(titleForPath('/settings/agent', t)).toBe(BRAND_NAME);
  });
});

describe('DocumentTitle', () => {
  it('resets the title to the brand name after leaving the login page', () => {
    // The old behaviour set document.title once on the login page and never
    // updated it again, so post-login pages kept the login title.
    document.title = `${BRAND_NAME} - stale login title`;
    render(
      <MemoryRouter initialEntries={['/guid']}>
        <DocumentTitle />
      </MemoryRouter>
    );
    expect(document.title).toBe(BRAND_NAME);
  });

  it('sets the localised login title on the login route', () => {
    mockLanguage = 'zh-CN';
    render(
      <MemoryRouter initialEntries={['/login']}>
        <DocumentTitle />
      </MemoryRouter>
    );
    expect(document.title).toBe('zh:login.pageTitle');
    mockLanguage = 'en-US';
  });
});
