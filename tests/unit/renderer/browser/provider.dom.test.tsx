import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserViewerProps } from '@/renderer/pages/conversation/Preview/browser/BrowserViewer';

type Stream = { type: string; conversation_id?: string; data: unknown };
const harness = vi.hoisted(() => ({
  views: new Map<string, BrowserViewerProps>(),
  mounts: 0,
  unmounts: 0,
  request: undefined as undefined | ((value: { conversationId: string }) => void),
  stream: undefined as undefined | ((value: Stream) => void),
  release: vi.fn(async () => {}),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    application: { releaseConversationBrowser: { invoke: harness.release } },
    fileStream: { contentUpdate: { on: () => () => {} } },
    preview: {
      open: { on: () => () => {} },
      requestBrowser: {
        on: (handler: typeof harness.request) => {
          harness.request = handler;
          return () => {};
        },
      },
    },
    conversation: {
      responseStream: {
        on: (handler: typeof harness.stream) => {
          harness.stream = handler;
          return () => {};
        },
      },
    },
    fs: { getFileMetadata: { invoke: async () => null } },
  },
}));
vi.mock('@/renderer/pages/conversation/Preview/browser/BrowserViewer', () => ({
  default: (props: BrowserViewerProps) => {
    harness.views.set(props.tabId, props);
    React.useEffect(() => {
      harness.mounts++;
      return () => {
        harness.unmounts++;
        harness.views.delete(props.tabId);
      };
    }, []);
    return <div data-testid={props.tabId} />;
  },
}));

import {
  PreviewProvider,
  usePreviewContext,
  type PreviewContextValue,
} from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { browserSessions, BROWSER_IDLE_MS } from '@/renderer/pages/conversation/Preview/browser/browserSessions';
import {
  resetCurrentConversationForTest,
  setCurrentConversation,
} from '@/renderer/pages/conversation/explorer/currentConversationStore';
import {
  clearPersistedPreviewScopes,
  previewScopeStorageKey,
} from '@/renderer/pages/conversation/Preview/context/previewScope';

let context: PreviewContextValue;
function Probe() {
  context = usePreviewContext();
  return null;
}
function mount() {
  render(
    <PreviewProvider>
      <Probe />
    </PreviewProvider>
  );
}
function switchConversation(owner: string, project = owner) {
  act(() => {
    setCurrentConversation(owner);
    context.closePreviewIfScopeChanged(project, owner);
  });
}
function open(url: string) {
  act(() => context.openBrowserTab(url));
  return context.tabs.find((tab) => tab.id === context.activeTabId)!;
}
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('aionui_agent_browser_first_use_notified', '1');
  harness.views.clear();
  harness.mounts = 0;
  harness.unmounts = 0;
  harness.release.mockClear();
  resetCurrentConversationForTest();
});
afterEach(() => {
  cleanup();
  resetCurrentConversationForTest();
  vi.restoreAllMocks();
});

describe('browser lifetimes across preview ownership changes', () => {
  it('keeps both real view lifetimes while switching projects and collapsing the panel', () => {
    mount();
    switchConversation('a');
    const a = open('https://example.com/a');
    switchConversation('b');
    const b = open('https://example.com/b');
    switchConversation('a');
    act(() => context.closePreview());
    expect([harness.mounts, harness.unmounts]).toEqual([2, 0]);
    expect([harness.views.get(a.id)?.conversationId, harness.views.get(b.id)?.conversationId]).toEqual(['a', 'b']);
    expect(context.tabs.filter((tab) => tab.content_type === 'browser').map((tab) => tab.id)).toEqual([a.id]);
  });

  it('restores the conversation-selected tab without changing the other conversation control target', () => {
    mount();
    switchConversation('a', 'shared');
    const first = open('https://example.com/first'),
      second = open('https://example.com/second');
    switchConversation('b', 'shared');
    const other = open('https://example.com/other');
    switchConversation('a', 'shared');
    expect(context.activeTabId).toBe(second.id);
    expect([harness.views.get(first.id)?.isControlTarget, harness.views.get(second.id)?.isControlTarget]).toEqual([
      false,
      true,
    ]);
    expect(harness.views.get(other.id)?.isControlTarget).toBe(true);
  });

  it('opens a background browser without replacing the visible page or reclaiming its running task', () => {
    mount();
    switchConversation('a');
    const a = open('https://example.com/a');
    act(() => harness.request?.({ conversationId: 'b' }));
    expect(context.activeTabId).toBe(a.id);
    expect(browserSessions.suspendIdle(Date.now() + BROWSER_IDLE_MS + 1, 'a')).toEqual([]);
    act(() => harness.stream?.({ type: 'finish', conversation_id: 'b', data: {} }));
    act(() => {
      browserSessions.suspendIdle(Date.now() + BROWSER_IDLE_MS + 1, 'a');
    });
    expect(harness.unmounts).toBe(1);
  });

  it('protects a new model-only turn until an explicit idle status, including confirmation waits', () => {
    mount();
    switchConversation('a');
    open('https://example.com/a');
    act(() => {
      harness.request?.({ conversationId: 'b' });
      harness.stream?.({ type: 'finish', conversation_id: 'b', data: {} });
      harness.stream?.({ type: 'agent_status', conversation_id: 'b', data: { backend: 'claude', status: 'running' } });
      harness.stream?.({ type: 'thinking', conversation_id: 'b', data: { content: '', status: 'done' } });
      harness.stream?.({ type: 'tool_call', conversation_id: 'b', data: { name: 'Read', status: 'completed' } });
      harness.stream?.({
        type: 'agent_status',
        conversation_id: 'b',
        data: { backend: 'claude', status: 'session_active' },
      });
    });
    expect(browserSessions.suspendIdle(Date.now() + BROWSER_IDLE_MS + 1, 'a')).toEqual([]);
    act(() =>
      harness.stream?.({
        type: 'agent_status',
        conversation_id: 'b',
        data: { backend: 'claude', status: 'waiting_confirmation' },
      })
    );
    expect(browserSessions.suspendIdle(Date.now() + BROWSER_IDLE_MS + 1, 'a')).toEqual([]);
    act(() =>
      harness.stream?.({ type: 'agent_status', conversation_id: 'b', data: { backend: 'claude', status: 'idle' } })
    );
    act(() => {
      expect(browserSessions.suspendIdle(Date.now() + BROWSER_IDLE_MS + 1, 'a')).toEqual(['b']);
    });
  });

  it('does not revive a completed turn from late tool and thinking-segment completion frames', () => {
    mount();
    switchConversation('a');
    open('https://example.com/a');
    act(() => {
      harness.request?.({ conversationId: 'b' });
      harness.stream?.({ type: 'thinking', conversation_id: 'b', data: { content: 'working', status: 'thinking' } });
      harness.stream?.({ type: 'agent_status', conversation_id: 'b', data: { backend: 'claude', status: 'done' } });
      harness.stream?.({ type: 'tool_call', conversation_id: 'b', data: { name: 'Read', status: 'completed' } });
      harness.stream?.({ type: 'thinking', conversation_id: 'b', data: { content: '', status: 'done' } });
    });
    act(() => {
      expect(browserSessions.suspendIdle(Date.now() + BROWSER_IDLE_MS + 1, 'a')).toEqual(['b']);
    });
  });

  it('explicitly clears only the current conversation browser and releases its control endpoint', () => {
    mount();
    switchConversation('a');
    const a = open('https://example.com/a');
    switchConversation('b');
    const b = open('https://example.com/b');
    switchConversation('a');
    act(() => context.clearPreviewForScope());
    expect([harness.views.has(a.id), harness.views.has(b.id)]).toEqual([false, true]);
    expect(harness.release).toHaveBeenCalledWith({ conversationId: 'a' });
    expect(browserSessions.forOwner('a')).toEqual([]);
  });

  it('clears a background activity badge when that conversation finishes', () => {
    mount();
    switchConversation('a');
    const a = open('https://example.com/a');
    act(() =>
      harness.stream?.({
        type: 'tool_call',
        conversation_id: 'a',
        data: { name: 'mcp__nexwork-browser__evaluate_script', status: 'running' },
      })
    );
    switchConversation('b');
    open('https://example.com/b');
    act(() => harness.stream?.({ type: 'finish', conversation_id: 'a', data: {} }));
    switchConversation('a');
    expect(context.tabs.find((tab) => tab.id === a.id)?.metadata?.agentActive).toBe(false);
  });

  it('disposes background pages and their endpoints when account state is cleared', () => {
    mount();
    switchConversation('a');
    open('https://example.com/a');
    switchConversation('b');
    open('https://example.com/b');
    act(() => clearPersistedPreviewScopes());
    act(() => context.openPreview('new account', 'markdown'));
    expect(harness.views.size).toBe(0);
    expect(harness.release.mock.calls).toEqual([[{ conversationId: 'a' }], [{ conversationId: 'b' }]]);
  });

  it('restores a stored browser under the requested conversation even when owner and scope change together', () => {
    mount();
    switchConversation('a');
    open('https://example.com/a');
    localStorage.setItem(
      previewScopeStorageKey('b'),
      JSON.stringify({
        isOpen: true,
        tabs: [
          {
            id: 'browser-restored-b',
            content: 'https://example.com/b',
            content_type: 'browser',
            title: 'B',
            metadata: { browserConversationId: 'b' },
          },
        ],
        activeTabId: 'browser-restored-b',
      })
    );
    switchConversation('b');
    expect(context.tabs.map((tab) => tab.id)).toEqual(['browser-restored-b']);
    expect(harness.views.get('browser-restored-b')?.conversationId).toBe('b');
    expect(context.activeTabId).toBe('browser-restored-b');
  });
});
