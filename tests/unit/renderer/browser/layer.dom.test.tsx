import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserSessions } from '@/renderer/pages/conversation/Preview/browser/browserSessions';
const mounted = vi.hoisted(() => ({ count: 0, unmounted: 0 }));
vi.mock('@/renderer/pages/conversation/Preview/browser/BrowserViewer', () => ({
  default: ({ tabId }: { tabId: string }) => {
    React.useEffect(() => {
      mounted.count++;
      return () => {
        mounted.unmounted++;
      };
    }, []);
    return <div data-testid={tabId} />;
  },
}));
import { PersistentBrowserLayer } from '@/renderer/pages/conversation/Preview/browser/PersistentBrowserLayer';
afterEach(() => {
  cleanup();
  browserSessions.clear();
  mounted.count = 0;
  mounted.unmounted = 0;
});
describe('persistent browser guests', () => {
  it('keeps both guests mounted through a conversation switch and panel collapse', () => {
    const a = browserSessions.ensure('a'),
      b = browserSessions.ensure('b');
    const view = render(<PersistentBrowserLayer slot={null} activeTabId={a.id} updateTab={() => {}} />);
    view.rerender(<PersistentBrowserLayer slot={null} activeTabId={b.id} updateTab={() => {}} />);
    view.rerender(<PersistentBrowserLayer slot={null} activeTabId={null} updateTab={() => {}} />);
    expect([mounted.count, mounted.unmounted]).toEqual([2, 0]);
  });
  it('unmounts only the idle page selected for reclamation', () => {
    const a = browserSessions.ensure('a');
    browserSessions.ensure('b');
    render(<PersistentBrowserLayer slot={null} activeTabId={a.id} updateTab={() => {}} />);
    act(() => {
      browserSessions.suspendIdle(Date.now() + 10000, 'a', 100);
    });
    expect(mounted.unmounted).toBe(1);
  });

  it('does not display the previous conversation page while its tab selection is stale', () => {
    const a = browserSessions.ensure('a');
    const slot = document.createElement('div');
    slot.getBoundingClientRect = () => new DOMRect(20, 10, 300, 200);
    const view = render(
      <PersistentBrowserLayer slot={slot} activeTabId={a.id} activeConversationId='b' updateTab={() => {}} />
    );
    expect(view.getByTestId(a.id).parentElement?.style.left).toBe('-10000px');
    view.rerender(
      <PersistentBrowserLayer slot={slot} activeTabId={a.id} activeConversationId='a' updateTab={() => {}} />
    );
    expect(view.getByTestId(a.id).parentElement?.style.left).toBe('20px');
  });
});
