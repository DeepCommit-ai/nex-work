/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The in-app browser must never spawn a standalone window: a new-window request from a
 * webview guest loads in that same webview (where the agent's CDP bridge can see it) or
 * is denied. Main windows and other contents keep Electron's default behaviour.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  type GuestContents,
  inAppWindowOpenTarget,
  installGuestWindowOpenPolicy,
} from '@process/resources/builtinMcp/guestWindowOpen';

type Handler = (details: { url: string }) => { action: 'deny' };

const fakeContents = (type: string) => {
  let handler: Handler | undefined;
  const contents: GuestContents = {
    getType: () => type,
    loadURL: vi.fn(() => Promise.resolve()),
    setWindowOpenHandler: vi.fn((h: Handler) => {
      handler = h;
    }),
  };
  return { contents, open: (url: string) => handler?.({ url }) };
};

const install = () => {
  let created: ((event: unknown, contents: GuestContents) => void) | undefined;
  installGuestWindowOpenPolicy({
    on: (_event, listener) => {
      created = listener;
    },
  });
  return (contents: GuestContents) => created?.({}, contents);
};

describe('installGuestWindowOpenPolicy', () => {
  it('opens an http(s) new-window request in the originating webview', () => {
    const create = install();
    const guest = fakeContents('webview');
    create(guest.contents);

    expect(guest.open('http://k3.example:8880/K3Cloud/HTML5/lightstartapp.aspx?ud=x')).toEqual({ action: 'deny' });
    expect(guest.contents.loadURL).toHaveBeenCalledWith('http://k3.example:8880/K3Cloud/HTML5/lightstartapp.aspx?ud=x');
  });

  it('denies non-web new-window requests without navigating', () => {
    const create = install();
    const guest = fakeContents('webview');
    create(guest.contents);

    expect(guest.open('about:blank')).toEqual({ action: 'deny' });
    expect(guest.open('javascript:alert(1)')).toEqual({ action: 'deny' });
    expect(guest.contents.loadURL).not.toHaveBeenCalled();
  });

  it('leaves main windows and other contents untouched', () => {
    const create = install();
    for (const type of ['window', 'browserView', 'remote', 'backgroundPage']) {
      const other = fakeContents(type);
      create(other.contents);
      expect(other.contents.setWindowOpenHandler).not.toHaveBeenCalled();
    }
  });

  it('swallows the ERR_ABORTED rejection a redirecting page produces', async () => {
    const create = install();
    const guest = fakeContents('webview');
    vi.mocked(guest.contents.loadURL).mockRejectedValueOnce(new Error('ERR_ABORTED (-3)'));
    create(guest.contents);

    expect(guest.open('https://oa.example/interface/Entrance.jsp?id=K3')).toEqual({ action: 'deny' });
    await Promise.resolve();
  });
});

describe('inAppWindowOpenTarget', () => {
  it('accepts http and https only', () => {
    expect(inAppWindowOpenTarget('https://a.example')).toBe('https://a.example');
    expect(inAppWindowOpenTarget('HTTP://A.EXAMPLE/x')).toBe('HTTP://A.EXAMPLE/x');
    expect(inAppWindowOpenTarget('file:///etc/passwd')).toBeNull();
    expect(inAppWindowOpenTarget('')).toBeNull();
  });
});
