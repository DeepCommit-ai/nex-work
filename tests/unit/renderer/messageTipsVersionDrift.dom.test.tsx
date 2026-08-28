/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * [ENTERPRISE PATCH] spec 002 (rev 6) — CLI version-drift notices
 * (CLI_VERSION_OLDER / CLI_VERSION_NEWER) are dev-only. In a production build
 * the tip names the concealed CLI ("claude … (Claude Code)") and asks the
 * employee to act on a version they do not manage — the bundled CLI is pinned
 * at build time. Production drops the tip entirely; dev keeps it because there
 * drift is real signal (PATH fallback, stale bundle after a version bump).
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({
  useFeedback: () => ({ openFeedback: vi.fn(() => Promise.resolve()) }),
}));

// CollapsibleContent uses ResizeObserver and runtime theme context — stub it
// so tests don't have to pull in the entire theme provider tree.
vi.mock('@renderer/components/chat/CollapsibleContent', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// MarkdownView pulls in a heavy markdown pipeline — replace with a passthrough.
vi.mock('@renderer/components/Markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import MessageTips, { shouldRenderTip } from '@/renderer/pages/conversation/Messages/components/MessageTips';
import type { IMessageTips } from '@/common/chat/chatLib';

const driftTip = (code: string): IMessageTips =>
  ({
    id: 'tip-1',
    type: 'tips',
    conversation_id: 'c1',
    content: {
      content: 'Installed claude is newer than the verified build (local 2.1.247 / verified 2.1.235)',
      type: 'warning',
      code,
      params: { cli: 'claude', reported: '2.1.247 (Claude Code)', verified: '2.1.235' },
    },
  }) as unknown as IMessageTips;

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  cleanup();
});

describe('shouldRenderTip', () => {
  it('conceals both drift codes in production', () => {
    expect(shouldRenderTip('CLI_VERSION_NEWER', 'production')).toBe(false);
    expect(shouldRenderTip('CLI_VERSION_OLDER', 'production')).toBe(false);
  });

  it('keeps drift codes visible outside production', () => {
    expect(shouldRenderTip('CLI_VERSION_NEWER', 'development')).toBe(true);
    expect(shouldRenderTip('CLI_VERSION_OLDER', 'test')).toBe(true);
  });

  it('never conceals other tips, coded or not', () => {
    expect(shouldRenderTip('AUTH_EXPIRED', 'production')).toBe(true);
    expect(shouldRenderTip(undefined, 'production')).toBe(true);
    expect(shouldRenderTip('', 'production')).toBe(true);
  });
});

describe('MessageTips version-drift concealment', () => {
  it('renders nothing for a drift tip in a production build', () => {
    process.env.NODE_ENV = 'production';
    const { container } = render(<MessageTips message={driftTip('CLI_VERSION_NEWER')} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('still renders the drift tip in a dev build', () => {
    process.env.NODE_ENV = 'development';
    render(<MessageTips message={driftTip('CLI_VERSION_NEWER')} />);
    expect(screen.getByText(/2\.1\.235/)).toBeInTheDocument();
  });

  it('leaves ordinary warnings untouched in production', () => {
    process.env.NODE_ENV = 'production';
    render(
      <MessageTips
        message={
          {
            id: 'tip-2',
            type: 'tips',
            conversation_id: 'c1',
            content: { content: 'plain warning body', type: 'warning' },
          } as unknown as IMessageTips
        }
      />
    );
    expect(screen.getByText('plain warning body')).toBeInTheDocument();
  });
});
