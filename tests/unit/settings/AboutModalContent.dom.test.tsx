/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  quitAndInstallMock: vi.fn(),
  autoUpdateCheckMock: vi.fn(),
  updateCheckMock: vi.fn(),
  messageInfoMock: vi.fn(),
  messageErrorMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      key === 'update.preparingInstall'
        ? '准备安装...'
        : key === 'settings.updateReadyInstall'
          ? `${params?.version} 已就绪, 立即安装`
          : key,
  }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: { ...actual.Message, info: mocks.messageInfoMock, error: mocks.messageErrorMock },
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    autoUpdate: {
      quitAndInstall: {
        invoke: mocks.quitAndInstallMock,
      },
      check: { invoke: mocks.autoUpdateCheckMock },
    },
    update: {
      check: { invoke: mocks.updateCheckMock },
    },
  },
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
  openExternalUrl: vi.fn(),
}));

vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'modal',
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/FeedbackReportModal', () => ({
  default: () => null,
}));

import AboutModalContent from '@/renderer/components/settings/SettingsModal/contents/AboutModalContent';
import { AUTO_UPDATE_ENABLED } from '@/branding';
import { setUpdateReadyState } from '@/renderer/components/settings/updateReadyState';

// NexWork ships with updates disabled (AUTO_UPDATE_ENABLED in
// src/branding/constants.ts), so the About panel renders no update controls at
// all. These cases are kept rather than deleted: flipping the flag back on for
// a company feed re-arms them automatically. See the companion suite below for
// the behaviour that IS asserted while updates are off.
describe.skipIf(!AUTO_UPDATE_ENABLED)('AboutModalContent update ready state', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '2.1.13');
    mocks.quitAndInstallMock.mockResolvedValue(undefined);
    mocks.autoUpdateCheckMock.mockResolvedValue({ success: true });
    mocks.updateCheckMock.mockResolvedValue({
      success: true,
      data: { currentVersion: '2.1.13', updateAvailable: false, latest: null },
    });
  });

  afterEach(() => {
    setUpdateReadyState({ ready: false, version: '' });
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('replaces check update with ready-to-install when an update package is ready', async () => {
    render(<AboutModalContent />);

    expect(screen.getByRole('button', { name: 'settings.checkForUpdates' })).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('aionui-update-ready-state-changed', {
          detail: {
            ready: true,
            version: '2.1.14',
          },
        })
      );
    });

    fireEvent.click(await screen.findByRole('button', { name: '2.1.14 已就绪, 立即安装' }));

    expect(mocks.quitAndInstallMock).toHaveBeenCalledTimes(1);
  });

  it('shows preparing loading state for ready auto-update install from About', async () => {
    let rejectInstall!: (error: Error) => void;
    mocks.quitAndInstallMock.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectInstall = reject;
        })
    );

    render(<AboutModalContent />);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('aionui-update-ready-state-changed', {
          detail: {
            ready: true,
            version: '2.1.14',
          },
        })
      );
    });

    fireEvent.click(await screen.findByRole('button', { name: '2.1.14 已就绪, 立即安装' }));

    expect(await screen.findByRole('button', { name: '准备安装...' })).toBeDisabled();
    expect(mocks.quitAndInstallMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectInstall(new Error('prepare failed'));
    });

    expect(await screen.findByRole('button', { name: '2.1.14 已就绪, 立即安装' })).not.toBeDisabled();
  });

  it('reveals the notification card only when an update is available, with no toast', async () => {
    mocks.updateCheckMock.mockResolvedValue({
      success: true,
      data: {
        currentVersion: '2.1.13',
        updateAvailable: true,
        latest: {
          tagName: 'v2.1.14',
          version: '2.1.14',
          name: 'v2.1.14',
          body: 'notes',
          htmlUrl: 'https://example.com/r',
          prerelease: false,
          draft: false,
          assets: [],
        },
      },
    });
    const availableListener = vi.fn();
    window.addEventListener('aionui-update-available', availableListener);

    render(<AboutModalContent />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.checkForUpdates' }));

    await waitFor(() => {
      expect(availableListener).toHaveBeenCalledTimes(1);
    });
    const detail = (availableListener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.kind).toBe('available');
    expect(detail.updateInfo.version).toBe('2.1.14');
    expect(mocks.messageInfoMock).not.toHaveBeenCalled();

    window.removeEventListener('aionui-update-available', availableListener);
  });

  it('shows an up-to-date toast and no card when there is no update', async () => {
    const availableListener = vi.fn();
    window.addEventListener('aionui-update-available', availableListener);

    render(<AboutModalContent />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.checkForUpdates' }));

    await waitFor(() => {
      expect(mocks.messageInfoMock).toHaveBeenCalledWith('update.alreadyLatest');
    });
    expect(availableListener).not.toHaveBeenCalled();

    window.removeEventListener('aionui-update-available', availableListener);
  });
});

/**
 * The shipped configuration: updates are off.
 *
 * The requirement is not merely "no update happens" but that nothing is
 * *offered* — no button that would do nothing, and no background network call
 * to upstream's feed from a control the user can still reach.
 */
describe.skipIf(AUTO_UPDATE_ENABLED)('AboutModalContent with updates disabled', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '2.1.13');
  });

  afterEach(() => {
    setUpdateReadyState({ ready: false, version: '' });
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('offers no check-for-updates control', () => {
    render(<AboutModalContent />);
    expect(screen.queryByRole('button', { name: 'settings.checkForUpdates' })).toBeNull();
  });

  it('hides the prerelease opt-in that only affects update checks', () => {
    render(<AboutModalContent />);
    expect(screen.queryByText('settings.includePrereleaseUpdates')).toBeNull();
  });

  it('performs no update check on render', async () => {
    // Nothing may reach upstream's feed: the updater it inherits still points at
    // https://static.aionui.com/releases.
    render(<AboutModalContent />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.updateCheckMock).not.toHaveBeenCalled();
    expect(mocks.autoUpdateCheckMock).not.toHaveBeenCalled();
  });

  it('still renders the rest of the About panel', () => {
    // The gate must remove the update block only, not the whole panel.
    render(<AboutModalContent />);
    expect(screen.getByText('NexWork')).toBeInTheDocument();
  });
});
