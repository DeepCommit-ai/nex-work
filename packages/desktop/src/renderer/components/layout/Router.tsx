import React, { Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppLoader from '@renderer/components/layout/AppLoader';
import DocumentTitle from '@renderer/components/layout/DocumentTitle';
import { useCrossSessionRateLimitNotice } from '@/renderer/hooks/system/useCrossSessionRateLimitNotice';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { TEAM_MODE_ENABLED } from '@/common/config/constants';
// [ENTERPRISE PATCH] spec 002 — server-controlled capability policy
import { useCapability } from '@/renderer/hooks/useCapability';
const Conversation = React.lazy(() => import('@renderer/pages/conversation'));
const Guid = React.lazy(() => import('@renderer/pages/guid'));
const AgentSettings = React.lazy(() => import('@renderer/pages/settings/AgentSettings'));
const AgentRepairPage = React.lazy(() => import('@renderer/pages/settings/AgentSettings/AgentRepairPage'));
const AssistantSettings = React.lazy(() => import('@renderer/pages/settings/AssistantSettings'));
const SkillsSettings = React.lazy(() => import('@renderer/pages/settings/SkillsSettings/SkillsHubSettings'));
const SkillDetailPage = React.lazy(() => import('@renderer/pages/settings/SkillsSettings/SkillDetailPage'));
const ToolsSettings = React.lazy(() => import('@renderer/pages/settings/ToolsSettings'));
const AppearanceSettings = React.lazy(() => import('@renderer/pages/settings/AppearanceSettings'));
const ModeSettings = React.lazy(() => import('@renderer/pages/settings/ModeSettings'));
const SystemSettings = React.lazy(() => import('@renderer/pages/settings/SystemSettings'));
const WebuiSettings = React.lazy(() => import('@renderer/pages/settings/WebuiSettings'));
const FeatureNotAvailable = React.lazy(() => import('@renderer/pages/settings/FeatureNotAvailable'));
// [ENTERPRISE PATCH] spec 006 — gateway provisioning
const GatewaySettings = React.lazy(() => import('@renderer/pages/settings/GatewaySettings'));
// [ENTERPRISE PATCH] 企业接入 —— 部门配置下发的入口，对员工始终可见
const EnterpriseSettings = React.lazy(() => import('@renderer/pages/settings/EnterpriseSettings'));
const ArchivedSettings = React.lazy(() => import('@renderer/pages/settings/ArchivedSettings'));
const ExtensionSettingsPage = React.lazy(() => import('@renderer/pages/settings/ExtensionSettingsPage'));
const LoginPage = React.lazy(() => import('@renderer/pages/login'));
const ComponentsShowcase = React.lazy(() => import('@renderer/pages/TestShowcase'));
const ScheduledTasksPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage'));
const TaskDetailPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage/TaskDetailPage'));
const TeamIndex = React.lazy(() => import('@renderer/pages/team'));

const withRouteFallback = (Component: React.LazyExoticComponent<React.ComponentType>) => (
  <Suspense fallback={<AppLoader />}>
    <Component />
  </Suspense>
);

/**
 * Legacy `/settings/capabilities?tab=tools` deep links now map to the standalone
 * Tools page; everything else (skills tab or no tab) lands on the Skills page.
 */
const CapabilitiesRedirect: React.FC = () => {
  const { search } = useLocation();
  const tab = new URLSearchParams(search).get('tab');
  return <Navigate to={tab === 'tools' ? '/settings/tools' : '/settings/skills'} replace />;
};

const ProtectedLayout: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status, user } = useAuth();
  // Mounted once for every authenticated route: the loop warning has to reach
  // the user even when they are looking at a THIRD conversation, which is the
  // whole reason it is a broadcast rather than an in-conversation banner.
  useCrossSessionRateLimitNotice(user?.id);

  if (status === 'checking') {
    return <AppLoader />;
  }

  if (status !== 'authenticated') {
    return <Navigate to='/login' replace />;
  }

  return React.cloneElement(layout);
};

const PanelRoute: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();
  // [ENTERPRISE PATCH] spec 002 FR-3
  const agentSettingsVisible = useCapability('agent.settingsVisible');

  return (
    <HashRouter>
      <DocumentTitle />
      <Routes>
        <Route
          path='/login'
          element={status === 'authenticated' ? <Navigate to='/guid' replace /> : withRouteFallback(LoginPage)}
        />
        <Route element={<ProtectedLayout layout={layout} />}>
          <Route index element={<Navigate to='/guid' replace />} />
          <Route path='/guid' element={withRouteFallback(Guid)} />
          <Route path='/conversation/:id' element={withRouteFallback(Conversation)} />
          <Route
            path='/team/:id'
            element={TEAM_MODE_ENABLED ? withRouteFallback(TeamIndex) : <Navigate to='/guid' replace />}
          />
          {/* [ENTERPRISE PATCH] spec 002 FR-3 — a gated route redirects rather than
              renders empty: an unreachable page that still exists in the router is
              reachable by typing the URL, and a blank one reads as a bug. */}
          <Route
            path='/settings/model'
            element={agentSettingsVisible ? withRouteFallback(ModeSettings) : <Navigate to='/guid' replace />}
          />
          <Route path='/assistants' element={withRouteFallback(AssistantSettings)} />
          {/* Assistants moved out of Settings to a top-level entry; keep a redirect
              so old deep links / back-nav still land on the new page. */}
          <Route path='/settings/assistants' element={<Navigate to='/assistants' replace />} />
          <Route
            path='/settings/agent'
            element={agentSettingsVisible ? withRouteFallback(AgentSettings) : <Navigate to='/guid' replace />}
          />
          <Route
            path='/settings/agent/:id/repair'
            element={agentSettingsVisible ? withRouteFallback(AgentRepairPage) : <Navigate to='/guid' replace />}
          />
          {/* Skills and Tools are top-level settings entries. */}
          <Route path='/settings/skills' element={withRouteFallback(SkillsSettings)} />
          <Route path='/settings/skills/import-history' element={withRouteFallback(SkillsSettings)} />
          <Route path='/settings/skills/detail/:skillName' element={withRouteFallback(SkillDetailPage)} />
          <Route path='/settings/tools' element={withRouteFallback(ToolsSettings)} />
          {/* Legacy routes — the previous combined "Capabilities" page is now two pages. */}
          <Route path='/settings/capabilities' element={<CapabilitiesRedirect />} />
          <Route
            path='/settings/capabilities/skills/import-history'
            element={<Navigate to='/settings/skills/import-history' replace />}
          />
          <Route path='/settings/skills-hub' element={<Navigate to='/settings/skills' replace />} />
          <Route path='/settings/appearance' element={withRouteFallback(AppearanceSettings)} />
          <Route path='/settings/display' element={<Navigate to='/settings/appearance' replace />} />
          {/* [ENTERPRISE PATCH] WebUI 远程访问暂未开通——入口保留,页面占位。恢复时换回 withRouteFallback(WebuiSettings)。 */}
          <Route path='/settings/webui' element={withRouteFallback(FeatureNotAvailable)} />
          {/* [ENTERPRISE PATCH] spec 006 */}
          {/* [ENTERPRISE PATCH] spec 002 FR-3 — the gateway page lists every runtime
              by name, so it is an administrator surface by the same argument as the
              agent page: measured against a live instance it rendered 15 CLI names. */}
          <Route
            path='/settings/gateway'
            element={agentSettingsVisible ? withRouteFallback(GatewaySettings) : <Navigate to='/guid' replace />}
          />
          <Route path='/settings/enterprise' element={withRouteFallback(EnterpriseSettings)} />
          {/* [ENTERPRISE PATCH] spec 002 FR-9 — 桌面宠物与「关于」页对本产品隐藏；
              直链同菜单一致，落回 /guid（与 gateway 的守卫同款）。 */}
          <Route path='/settings/pet' element={<Navigate to='/guid' replace />} />
          <Route path='/settings/archived' element={withRouteFallback(ArchivedSettings)} />
          <Route path='/settings/system' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/about' element={<Navigate to='/guid' replace />} />
          <Route path='/settings/ext/:tabId' element={withRouteFallback(ExtensionSettingsPage)} />
          {/* The bare `/settings` landing followed the agent page. With that page
              gated it would land on a redirect to `/guid`, i.e. the settings entry
              would silently throw the user out of settings. */}
          <Route
            path='/settings'
            element={<Navigate to={agentSettingsVisible ? '/settings/agent' : '/settings/appearance'} replace />}
          />
          <Route path='/test/components' element={withRouteFallback(ComponentsShowcase)} />
          <Route path='/scheduled' element={withRouteFallback(ScheduledTasksPage)} />
          <Route path='/scheduled/:job_id' element={withRouteFallback(TaskDetailPage)} />
        </Route>
        <Route path='*' element={<Navigate to={status === 'authenticated' ? '/guid' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
};

export default PanelRoute;
