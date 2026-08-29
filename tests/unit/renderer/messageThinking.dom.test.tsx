/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageThinking } from '@/common/chat/chatLib';
import MessageThinking from '@/renderer/pages/conversation/Messages/components/MessageThinking';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

function createThinkingMessage(createdAt: number, content?: Partial<IMessageThinking['content']>): IMessageThinking {
  return {
    id: 'thinking-1',
    type: 'thinking',
    msg_id: 'msg-1',
    conversation_id: 'conversation-1',
    position: 'left',
    created_at: createdAt,
    content: {
      content: 'analyzing',
      status: 'thinking',
      ...content,
    },
  };
}

describe('MessageThinking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves elapsed time when the component remounts for an active thinking message', () => {
    vi.setSystemTime(new Date('2026-05-26T09:00:10.000Z'));
    const createdAt = Date.now() - 5_000;

    const { unmount } = render(<MessageThinking message={createThinkingMessage(createdAt)} />);

    expect(screen.getByText('Thinking... · 5s')).toBeInTheDocument();

    unmount();

    vi.setSystemTime(new Date('2026-05-26T09:00:12.000Z'));
    render(<MessageThinking message={createThinkingMessage(createdAt)} />);

    expect(screen.getByText('Thinking... · 7s')).toBeInTheDocument();
  });

  // [spec 008] 起点未亲见的气泡不许显示会撒谎的计时。
  it('hides the elapsed counter when the segment start was not witnessed', () => {
    vi.setSystemTime(new Date('2026-05-26T09:00:10.000Z'));
    render(<MessageThinking message={createThinkingMessage(Date.now(), { startUnwitnessed: true })} />);

    expect(screen.getByText('Thinking...')).toBeInTheDocument();
    expect(screen.queryByText(/Thinking\.\.\. · /)).toBeNull();
  });

  it('omits the duration suffix when a completed thinking has no trustworthy duration', () => {
    render(<MessageThinking message={createThinkingMessage(Date.now(), { status: 'done', content: '' })} />);

    expect(screen.getByText('Thought complete')).toBeInTheDocument();
    expect(screen.queryByText(/Thought complete · /)).toBeNull();
  });

  it('still shows the stored duration when one exists', () => {
    render(
      <MessageThinking message={createThinkingMessage(Date.now(), { status: 'done', content: '', duration: 2298 })} />
    );

    expect(screen.getByText('Thought complete · 2s')).toBeInTheDocument();
  });
});
