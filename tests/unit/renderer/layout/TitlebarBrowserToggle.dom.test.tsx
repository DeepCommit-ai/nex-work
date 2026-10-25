import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const guests = vi.hoisted(() => ({ mounted: 0, unmounted: 0 }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/conversation/a', search: '', hash: '' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { get: { invoke: vi.fn() }, responseStream: { on: () => () => {} } },
    fileStream: { contentUpdate: { on: () => () => {} } },
    preview: { open: { on: () => () => {} }, requestBrowser: { on: () => () => {} } },
  },
}));
vi.mock('@/common/config/constants', () => ({ TEAM_MODE_ENABLED: false }));
vi.mock('@renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Titlebar/MobileConversationBrand', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/WindowControls', () => ({ default: () => null }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('@/renderer/hooks/context/NavigationHistoryContext', () => ({ useNavigationHistory: () => null }));
vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({ useFeedback: () => ({ openFeedback: vi.fn() }) }));
vi.mock('@/renderer/services/feedback/resolveFeedbackModule', () => ({
  resolveFeedbackModule: () => 'conversation-session',
}));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => true, isMacOS: () => false }));
vi.mock('@/renderer/pages/conversation/Preview/browser/BrowserViewer', () => ({
  default: ({ tabId }: { tabId: string }) => {
    React.useEffect(() => {
      guests.mounted++;
      return () => {
        guests.unmounted++;
      };
    }, []);
    return <input data-testid={tabId} defaultValue='form draft' />;
  },
}));

import Titlebar from '@/renderer/components/layout/Titlebar';
import {
  PreviewProvider,
  usePreviewContext,
  type PreviewContextValue,
} from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { useWorkspaceCollapse } from '@/renderer/pages/conversation/hooks/useWorkspaceCollapse';
import {
  resetCurrentConversationForTest,
  setCurrentConversation,
} from '@/renderer/pages/conversation/explorer/currentConversationStore';

let preview: PreviewContextValue;
let workspaceCollapsed: boolean;
const Probe = () => {
  preview = usePreviewContext();
  workspaceCollapsed = useWorkspaceCollapse({ workspaceEnabled: true, isMobile: false }).rightSiderCollapsed;
  return null;
};
const renderToolbar = () =>
  render(
    <PreviewProvider>
      <Titlebar workspaceAvailable />
      <Probe />
    </PreviewProvider>
  );
const browserButton = () =>
  screen.getByRole('button', {
    name:
      preview.isOpen && preview.activeTab?.content_type === 'browser'
        ? 'preview.browser.hideBrowser'
        : 'preview.browser.showBrowser',
  });

beforeEach(() => {
  localStorage.clear();
  resetCurrentConversationForTest();
  setCurrentConversation('a');
  guests.mounted = 0;
  guests.unmounted = 0;
});
afterEach(() => {
  cleanup();
  resetCurrentConversationForTest();
});

describe('Titlebar browser toggle', () => {
  it('opens a browser directly while the workspace stays collapsed', () => {
    renderToolbar();
    fireEvent.click(browserButton());

    expect(preview.activeTab?.content).toBe('about:blank');
    expect(workspaceCollapsed).toBe(true);
    expect(browserButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('places a separate browser action between feedback and the workspace', () => {
    renderToolbar();
    const browser = browserButton();
    expect(screen.getByRole('button', { name: 'conversation.welcome.quickActionFeedback' }).nextElementSibling).toBe(
      browser
    );
    expect(browser.nextElementSibling).toBe(screen.getByRole('button', { name: 'common.showWorkspace' }));
  });

  it('hides and restores the same guest with its unsaved form intact', () => {
    renderToolbar();
    fireEvent.click(browserButton());
    const tabId = preview.activeTabId as string;
    const guest = screen.getByTestId(tabId);
    fireEvent.change(guest, { target: { value: 'unsaved form contents' } });
    fireEvent.click(browserButton());
    expect(preview.isOpen).toBe(false);
    fireEvent.click(browserButton());

    expect(screen.getByTestId(tabId)).toBe(guest);
    expect({
      value: (guest as HTMLInputElement).value,
      mounts: guests.mounted,
      unmounts: guests.unmounted,
      tabs: preview.tabs.length,
    }).toEqual({ value: 'unsaved form contents', mounts: 1, unmounts: 0, tabs: 1 });
  });

  it('changes each panel visibility without changing the other panel', () => {
    renderToolbar();
    const states: boolean[][] = [];
    fireEvent.click(screen.getByRole('button', { name: 'common.showWorkspace' }));
    states.push([workspaceCollapsed, preview.isOpen]);
    fireEvent.click(browserButton());
    states.push([workspaceCollapsed, preview.isOpen]);
    fireEvent.click(screen.getByRole('button', { name: 'common.hideWorkspace' }));
    states.push([workspaceCollapsed, preview.isOpen]);
    fireEvent.click(screen.getByRole('button', { name: 'common.showWorkspace' }));
    fireEvent.click(browserButton());
    states.push([workspaceCollapsed, preview.isOpen]);

    expect(states).toEqual([
      [false, false],
      [false, true],
      [true, true],
      [false, false],
    ]);
    expect([guests.mounted, guests.unmounted]).toEqual([1, 0]);
  });

  it('restores the last selected browser without replacing an edited document', () => {
    renderToolbar();
    act(() => preview.openBrowserTab('https://a.example'));
    const selectedId = preview.activeTabId;
    act(() => preview.openBrowserTab('https://b.example'));
    act(() => preview.switchTab(selectedId as string));
    act(() => preview.openPreview('original', 'code'));
    act(() => preview.updateContent('unsaved document'));
    const documentId = preview.activeTabId;
    fireEvent.click(browserButton());

    expect(preview.activeTabId).toBe(selectedId);
    expect(preview.tabs.find((tab) => tab.id === documentId)).toMatchObject({
      content: 'unsaved document',
      isDirty: true,
    });
    expect([guests.mounted, guests.unmounted]).toEqual([2, 0]);
  });

  it('keeps each conversation browser when switching and reopening the panel', () => {
    renderToolbar();
    act(() => preview.openBrowserTab('https://a.example'));
    const firstId = preview.activeTabId;
    act(() => setCurrentConversation('b'));
    fireEvent.click(browserButton());
    const secondId = preview.activeTabId;
    expect(preview.activeTab?.metadata?.browserConversationId).toBe('b');
    fireEvent.click(browserButton());
    act(() => setCurrentConversation('a'));
    fireEvent.click(browserButton());

    expect({ activeId: preview.activeTabId, address: preview.activeTab?.content }).toEqual({
      activeId: firstId,
      address: 'https://a.example',
    });
    expect({ distinct: secondId !== firstId, mounts: guests.mounted, unmounts: guests.unmounted }).toEqual({
      distinct: true,
      mounts: 2,
      unmounts: 0,
    });
  });

  it('omits the browser action when no preview provider is available', () => {
    render(<Titlebar workspaceAvailable />);
    expect(screen.queryByRole('button', { name: 'preview.browser.showBrowser' })).not.toBeInTheDocument();
  });

  it('omits the browser action outside conversations', () => {
    render(
      <PreviewProvider>
        <Titlebar workspaceAvailable={false} />
      </PreviewProvider>
    );
    expect(screen.queryByRole('button', { name: 'preview.browser.showBrowser' })).not.toBeInTheDocument();
  });
});
