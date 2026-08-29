/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * [ENTERPRISE PATCH] spec 007 FR-5 — auto-open the in-app browser tab when the
 * agent starts driving the browser MCP and no browser tab exists.
 *
 * Measured live: MCP lane healthy end to end (bridge answering, wrapper and
 * chrome-devtools-mcp alive on the right port), yet every browser tool call
 * dead-ended in "The in-app browser is not currently attached" because
 * attaching requires a mounted browser-tab webview and a fresh conversation has
 * none. The employee was being asked to find a panel they had never seen.
 */

import React from 'react';
import { act, render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StreamHandler = (message: { type: string; data: unknown }) => void;
const streamHandlers: StreamHandler[] = [];

vi.mock('@/common', () => ({
  ipcBridge: {
    fileStream: { contentUpdate: { on: () => () => {} } },
    preview: { open: { on: () => () => {} } },
    conversation: {
      responseStream: {
        on: (handler: StreamHandler) => {
          streamHandlers.push(handler);
          return () => {};
        },
      },
    },
    fs: {
      writeFile: { invoke: async () => true },
      getFileMetadata: { invoke: async () => null },
      readFile: { invoke: async () => null },
      getImageBase64: { invoke: async () => null },
    },
  },
}));

import {
  PreviewProvider,
  usePreviewContext,
  type PreviewContextValue,
} from '@/renderer/pages/conversation/Preview/context/PreviewContext';

let ctx: PreviewContextValue;
const Probe: React.FC = () => {
  ctx = usePreviewContext();
  return null;
};

const mount = (): void => {
  render(
    <PreviewProvider>
      <Probe />
    </PreviewProvider>
  );
};

const emit = (message: { type: string; data: unknown }): void => {
  act(() => {
    for (const handler of streamHandlers) handler(message);
  });
};

const browserActivity = { type: 'tool_group', data: [{ name: 'aionui-browser__navigate_page', status: 'Executing' }] };

const browserTabs = () => ctx.tabs.filter((tab) => tab.content_type === 'browser');

beforeEach(() => {
  localStorage.clear();
  // Silence the one-time first-use notification — it is not what this file tests.
  localStorage.setItem('aionui_agent_browser_first_use_notified', '1');
  streamHandlers.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('browser MCP activity auto-opens the in-app browser (spec 007 FR-5)', () => {
  it('opens a browser tab when activity starts with none open', () => {
    mount();
    expect(browserTabs()).toHaveLength(0);

    emit(browserActivity);

    expect(browserTabs()).toHaveLength(1);
    expect(ctx.isOpen).toBe(true);
  });

  it('does not open a second tab when one already exists', () => {
    mount();
    act(() => {
      ctx.openBrowserTab('https://example.com');
    });
    expect(browserTabs()).toHaveLength(1);

    emit(browserActivity);

    expect(browserTabs()).toHaveLength(1);
  });

  it('opens on the direct-CLI (Claude Code) tool_call shape — mcp__ prefix, single entry', () => {
    // 实测形态（会话 1cacdbcc）：逐条 tool_call、mcp__ 前缀、小写 running。
    mount();

    emit({
      type: 'tool_call',
      data: { call_id: 'call_1', name: 'mcp__aionui-browser__list_pages', args: {}, status: 'running' },
    });

    expect(browserTabs()).toHaveLength(1);
    expect(ctx.isOpen).toBe(true);
  });

  it('ignores tool activity that is not the browser MCP', () => {
    mount();

    emit({ type: 'tool_group', data: [{ name: 'some_other_tool', status: 'Executing' }] });

    expect(browserTabs()).toHaveLength(0);
  });

  it('does not reopen on the settled event after the user closes the tab', () => {
    mount();
    emit(browserActivity);
    const [tab] = browserTabs();
    act(() => {
      ctx.closeTab(tab.id);
    });
    expect(browserTabs()).toHaveLength(0);

    emit({ type: 'tool_group', data: [{ name: 'aionui-browser__navigate_page', status: 'Success' }] });

    expect(browserTabs()).toHaveLength(0);
  });
});
