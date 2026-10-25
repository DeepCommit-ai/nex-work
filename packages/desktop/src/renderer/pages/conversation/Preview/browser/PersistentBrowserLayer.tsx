import React, { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import BrowserViewer from './BrowserViewer';
import { browserSessions } from './browserSessions';
import type { PreviewTabPatch } from '../context/PreviewContext';

/** Keep guests mounted at app scope; the visible panel supplies only a viewport. */
export const PersistentBrowserLayer: React.FC<{
  slot: HTMLElement | null;
  activeTabId: string | null;
  activeConversationId?: string;
  updateTab: (id: string, patch: PreviewTabPatch) => void;
}> = ({ slot, activeTabId, activeConversationId, updateTab }) => {
  const entries = useSyncExternalStore(browserSessions.subscribe, browserSessions.getSnapshot);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const hasActiveBrowser = entries.some(
    ({ tab, owner, live }) =>
      live && tab.id === activeTabId && (!activeConversationId || activeConversationId === owner)
  );
  useLayoutEffect(() => {
    if (!slot || !hasActiveBrowser) {
      setRect(null);
      return;
    }
    let previous: DOMRect | null = null;
    const measure = () => {
      const next = slot.getBoundingClientRect();
      if (
        !previous ||
        previous.left !== next.left ||
        previous.top !== next.top ||
        previous.width !== next.width ||
        previous.height !== next.height
      ) {
        previous = next;
        setRect(next);
      }
    };
    measure();
    // Sibling panels and their transitions can move the slot without resizing
    // it. ResizeObserver alone leaves the fixed guest at its previous position.
    // Track just the visible viewport and only update React when bounds change.
    let frame: number;
    const trackPosition = () => {
      measure();
      frame = requestAnimationFrame(trackPosition);
    };
    frame = requestAnimationFrame(trackPosition);
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [slot, activeTabId, hasActiveBrowser]);
  const patch = (id: string, value: PreviewTabPatch) => {
    browserSessions.patch(id, value);
    updateTab(id, value);
  };
  return (
    <>
      {entries
        .filter((entry) => entry.live)
        .map(({ tab, owner }) => {
          const visible =
            !!rect &&
            rect.width > 0 &&
            rect.height > 0 &&
            activeTabId === tab.id &&
            (!activeConversationId || activeConversationId === owner);
          return (
            <div
              key={tab.id}
              aria-hidden={!visible}
              data-browser-view={tab.id}
              className='flex flex-col overflow-hidden bg-1'
              style={{
                position: 'fixed',
                left: visible ? rect!.left : -10000,
                top: visible ? rect!.top : 0,
                width: visible ? rect!.width : 1024,
                height: visible ? rect!.height : 768,
                zIndex: visible ? 25 : -1,
                pointerEvents: visible ? undefined : 'none',
              }}
            >
              <BrowserViewer
                url={tab.content}
                tabId={tab.id}
                conversationId={owner === 'manual' ? undefined : owner}
                isControlTarget={browserSessions.selectedTab(owner) === tab.id}
                onUrlChange={(id, content) => patch(id, { content })}
                onTitleChange={(id, title) => patch(id, { title })}
                onFaviconChange={(id, favicon) => patch(id, { metadata: { favicon } })}
                onDirtyChange={(dirty) => browserSessions.dirty(tab.id, dirty)}
              />
            </div>
          );
        })}
    </>
  );
};
