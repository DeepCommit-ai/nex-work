import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedSyncStatus } from '@/common/deptconfig/catalog';
import zh from '@/renderer/services/i18n/locales/zh-CN/settings.json';
import EnterpriseSettings from '@/renderer/pages/settings/EnterpriseSettings';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  sync: vi.fn(),
  apply: vi.fn(),
  url: vi.fn(),
  key: vi.fn(),
  listener: undefined as ((value: ManagedSyncStatus) => void) | undefined,
}));
vi.mock('@/common/adapter/ipcBridge', () => ({
  managedAgents: {
    status: { invoke: mocks.status },
    sync: { invoke: mocks.sync },
    changed: {
      on: (listener: (value: ManagedSyncStatus) => void) => {
        mocks.listener = listener;
        return () => {
          mocks.listener = undefined;
        };
      },
    },
  },
}));
vi.mock('@/renderer/services/enterpriseStore', () => ({
  enterpriseStore: { getServerUrl: mocks.url, getDeptKey: mocks.key },
}));
vi.mock('@/renderer/services/deptConfigService', () => ({ applyDeptConfig: mocks.apply }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => true }));
vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'zh-CN' },
    t: (key: string, args: Record<string, unknown> = {}) => {
      let value: unknown = { settings: zh, common: { cancel: '取消' } };
      for (const part of key.split('.')) value = (value as Record<string, unknown>)?.[part];
      return String(value ?? key).replace(/{{(\w+)}}/g, (_, name: string) => String(args[name] ?? ''));
    },
  }),
}));

const connected = (): ManagedSyncStatus => ({
  phase: 'ready',
  push: 'connected',
  version: 'v14/agents/4',
  assistantIds: [],
  installedAt: 1000,
  checkedAt: 2000,
  connection: { state: 'connected', serverUrl: 'https://active.example.com', dept: 'sales', verifiedAt: 2000 },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue(connected());
  mocks.url.mockResolvedValue('https://active.example.com');
  mocks.key.mockResolvedValue('stored-secret');
  mocks.sync.mockResolvedValue({ success: true, status: connected() });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addListener() {}, removeListener() {} }),
  });
});
afterEach(cleanup);

async function openConnected(): Promise<void> {
  render(<EnterpriseSettings />);
  await screen.findByText('部门标识：sales');
}

describe('enterprise connection settings', () => {
  it('hides credentials and technical details until explicitly expanded', async () => {
    await openConnected();
    expect(screen.queryByPlaceholderText('已保存，留空沿用原密钥')).not.toBeInTheDocument();
    expect(screen.queryByText(/v14\/agents\/4/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('技术详情'));
    expect(await screen.findByText('已安装版本：v14/agents/4')).toBeVisible();
  });
  it('keeps the current destination visible when a replacement fails', async () => {
    mocks.apply.mockResolvedValue({ status: 'failed', detail: 'private diagnostic', errorCode: 'INVALID_KEY' });
    await openConnected();
    fireEvent.click(screen.getByRole('button', { name: '更换连接' }));
    fireEvent.change(screen.getByPlaceholderText('例如 https://work.example.com'), {
      target: { value: 'https://new.example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('已保存，留空沿用原密钥'), { target: { value: 'wrong-key' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并获取助手' }));
    await screen.findByText('部门密钥无效或已失效，请向管理员确认后重新输入');
    expect(screen.getByText('https://active.example.com')).toBeVisible();
    expect(screen.getByText('部门标识：sales')).toBeVisible();
    expect(screen.queryByText('private diagnostic')).not.toBeInTheDocument();
  });
  it('does not prefill a saved department key when changing connection', async () => {
    await openConnected();
    fireEvent.click(screen.getByRole('button', { name: '更换连接' }));
    expect(screen.getByPlaceholderText('已保存，留空沿用原密钥')).toHaveValue('');
    expect(screen.getByPlaceholderText('例如 https://work.example.com')).toHaveValue('https://active.example.com');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByText('连接设置')).not.toBeInTheDocument();
  });
  it('shows the form for a new installation and prevents empty-key requests', async () => {
    mocks.status.mockResolvedValue({
      phase: 'idle',
      push: 'disconnected',
      assistantIds: [],
      connection: { state: 'unconfigured' },
    });
    mocks.url.mockResolvedValue(undefined);
    mocks.key.mockResolvedValue(undefined);
    render(<EnterpriseSettings />);
    fireEvent.change(await screen.findByPlaceholderText('例如 https://work.example.com'), {
      target: { value: 'https://new.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '连接并获取助手' }));
    expect(await screen.findByText('请填写部门密钥')).toBeVisible();
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('shows stale identity after a network failure and allows checking again', async () => {
    await openConnected();
    const offline: ManagedSyncStatus = {
      ...connected(),
      phase: 'error',
      error: 'fetch failed',
      errorCode: 'SERVICE_UNREACHABLE',
      connection: { ...connected().connection!, state: 'unreachable' },
    };
    act(() => mocks.listener?.(offline));
    expect(screen.getByText('暂时无法连接')).toBeVisible();
    expect(screen.getByText('当前显示上次验证的部门信息，连接恢复后会重新确认')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '检查连接' }));
    await waitFor(() => expect(screen.getByText('已连接')).toBeVisible());
  });
  it('does not turn a push interruption into a whole-service outage', async () => {
    mocks.status.mockResolvedValue({ ...connected(), push: 'disconnected' });
    await openConnected();
    expect(screen.getByText('已连接')).toBeVisible();
    expect(screen.queryByText('暂时无法连接')).not.toBeInTheDocument();
  });
  it('shows safe error categories without exposing raw diagnostics in technical details', async () => {
    mocks.status.mockResolvedValue({
      ...connected(),
      phase: 'error',
      error: 'model=private-model key=private-secret',
      errorCode: 'UPDATE_FAILED',
    });
    await openConnected();
    fireEvent.click(screen.getByText('技术详情'));
    expect(await screen.findByText('错误代码：UPDATE_FAILED')).toBeVisible();
    expect(screen.queryByText(/private-model|private-secret/)).not.toBeInTheDocument();
  });
});
