import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/conversation/a', search: '', hash: '' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { get: { invoke: vi.fn() } } } }));
vi.mock('@/common/config/constants', () => ({ TEAM_MODE_ENABLED: false }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Titlebar/MobileConversationBrand', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/WindowControls', () => ({ default: () => null }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('@/renderer/hooks/context/NavigationHistoryContext', () => ({ useNavigationHistory: () => null }));
vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({ useFeedback: () => ({ openFeedback: vi.fn() }) }));
vi.mock('@/renderer/services/feedback/resolveFeedbackModule', () => ({
  resolveFeedbackModule: () => 'conversation-session',
}));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => true, isMacOS: () => false }));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  useOptionalPreviewContext: () => ({ isOpen: true, activeTab: { content_type: 'browser' }, toggleBrowser: vi.fn() }),
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ isOpen: true, isMaximized: false }),
  PreviewPanel: () => null,
}));
vi.mock('@/renderer/pages/conversation/components/ChatTitleEditor', () => ({ default: () => null }));
vi.mock('@/renderer/components/agent/AgentBadge', () => ({ AgentLogoIcon: () => null }));
vi.mock('@/renderer/pages/conversation/components/ChatLayout/WorkspacePanelHeader', () => ({ default: () => null }));
vi.mock('@/renderer/pages/conversation/components/ChatLayout/MobileWorkspaceOverlay', () => ({ default: () => null }));
vi.mock('@/renderer/pages/conversation/hooks/useTitleRename', () => ({
  useTitleRename: () => ({ editingTitle: false, titleDraft: '', setTitleDraft: vi.fn(), setEditingTitle: vi.fn() }),
}));
vi.mock('@/renderer/pages/conversation/hooks/useContainerWidth', () => ({
  useContainerWidth: () => ({ containerRef: { current: null }, containerWidth: 1200 }),
}));
vi.mock('@/renderer/hooks/ui/useResizableSplit', () => ({
  useResizableSplit: () => ({ splitRatio: 300, setSplitRatio: vi.fn(), createDragHandle: () => null }),
}));
vi.mock('@/renderer/pages/conversation/explorer/ExplorerContainer', () => ({
  ExplorerContainer: () => <div role='tree'>synthetic.txt</div>,
}));

import Titlebar from '@/renderer/components/layout/Titlebar';
import ChatLayout from '@/renderer/pages/conversation/components/ChatLayout';
import { useProjectPanelCollapse } from '@/renderer/hooks/ui/useProjectPanelCollapse';
import { ProjectPanelHost } from '@/renderer/components/layout/ProjectPanelHost';
import { dispatchWorkspaceStateEvent } from '@/renderer/utils/workspace/workspaceEvents';
import {
  resetCurrentProjectForTest,
  setCurrentProject,
} from '@/renderer/pages/conversation/explorer/currentProjectStore';

// Layout owns the project column before async conversation content mounts its
// legacy ChatLayout. Keep both real collapse hooks and the real Titlebar wired.
const Shell = ({
  contentReady,
  projectId,
  workspaceEnabled = !projectId,
}: {
  contentReady: boolean;
  projectId: string | null;
  workspaceEnabled?: boolean;
}) => {
  const { collapsed } = useProjectPanelCollapse({ projectId, isMobile: false, active: Boolean(projectId) });
  return (
    <>
      <Titlebar workspaceAvailable />
      {contentReady && (
        <ChatLayout workspaceEnabled={workspaceEnabled} previewHosted={Boolean(projectId)} sider={null}>
          <div />
        </ChatLayout>
      )}
      <ProjectPanelHost widthPx={260} collapsed={collapsed} />
    </>
  );
};

beforeEach(() => {
  localStorage.clear();
  resetCurrentProjectForTest();
  setCurrentProject('project-a');
});
afterEach(() => {
  cleanup();
  resetCurrentProjectForTest();
});

describe('Titlebar workspace state ownership', () => {
  it('keeps the project state authoritative when a legacy ChatLayout mounts with preview open', () => {
    const view = render(<Shell contentReady={false} projectId='project-a' />);
    view.rerender(<Shell contentReady projectId='project-a' />);

    const workspace = screen.getByRole('button', { name: /common\.(show|hide)Workspace/ });
    const column = view.container.querySelector<HTMLElement>('[data-project-panel-host]')!;
    const state = () => ({
      pressed: workspace.getAttribute('aria-pressed'),
      collapsed: column.dataset.collapsed,
      width: column.style.width,
    });
    const observed = [state()];
    fireEvent.click(workspace);
    observed.push(state());
    fireEvent.click(workspace);
    observed.push(state());

    expect(observed).toEqual([
      { pressed: 'true', collapsed: 'false', width: '260px' },
      { pressed: 'false', collapsed: 'true', width: '0px' },
      { pressed: 'true', collapsed: 'false', width: '260px' },
    ]);
    expect(screen.getByRole('tree')).toHaveTextContent('synthetic.txt');
  });

  it('still publishes the enabled legacy workspace state without a project owner', () => {
    setCurrentProject(null);
    const view = render(<Shell contentReady={false} projectId={null} />);
    view.rerender(<Shell contentReady projectId={null} />);
    expect(screen.getByRole('button', { name: 'common.showWorkspace' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'common.showWorkspace' }));
    expect(screen.getByRole('button', { name: 'common.hideWorkspace' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('resets a stale expanded control for an unbound conversation without a workspace', () => {
    setCurrentProject(null);
    const view = render(<Shell contentReady={false} projectId={null} workspaceEnabled={false} />);
    act(() => dispatchWorkspaceStateEvent(false));
    expect(screen.getByRole('button', { name: 'common.hideWorkspace' })).toHaveAttribute('aria-pressed', 'true');
    view.rerender(<Shell contentReady projectId={null} workspaceEnabled={false} />);

    expect(screen.getByRole('button', { name: 'common.showWorkspace' })).toHaveAttribute('aria-pressed', 'false');
  });
});
