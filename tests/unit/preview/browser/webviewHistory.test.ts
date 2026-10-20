/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Guards for WebviewHost's internal-navigation echo detection.
 *
 * Back/forward themselves are delegated to the webview's own history, so there is no
 * hand-rolled stack left to test. What remains is deciding whether an incoming `url`
 * prop is a genuine external change (switch tab / preview target) or merely the echo
 * of a navigation this component just made — getting that wrong caused a redirect
 * ping-pong that killed the renderer. WebviewHost cannot be rendered under jsdom
 * (<webview> is an Electron-only tag that never mounts), so the decision is extracted
 * here as a plain unit and tested directly.
 */

import { describe, expect, it } from 'vitest';
import {
  InternalNavTracker,
  shouldLoadUrlProp,
  shouldResetHistoryForUrlProp,
} from '@/renderer/components/media/webviewHistory';

describe('shouldResetHistoryForUrlProp', () => {
  it('keeps history when the url prop is the echo of an internal navigation', () => {
    const tracker = new InternalNavTracker();
    tracker.record('https://b.example');
    expect(shouldResetHistoryForUrlProp('https://b.example', tracker)).toBe(false);
  });

  it('resets history when the url prop changes externally (tab / preview switch)', () => {
    const tracker = new InternalNavTracker();
    tracker.record('https://b.example');
    expect(shouldResetHistoryForUrlProp('https://external.example', tracker)).toBe(true);
  });

  it('resets history when no internal navigation has happened yet', () => {
    expect(shouldResetHistoryForUrlProp('https://a.example', new InternalNavTracker())).toBe(true);
  });

  /**
   * Regression guard for the redirect-chain crash.
   *
   * A redirect fires did-navigate twice in a row (A then B). Tracking only the most
   * recent target means that once B is recorded, A's late-arriving prop echo looks
   * external — so the address was set back to A, the redirect ran again, and
   * A → B → A ping-ponged at ~13 navigations/second until the renderer process died.
   * Both echoes must be recognised, in either arrival order.
   */
  it('recognises every echo of a redirect chain, not just the most recent', () => {
    const tracker = new InternalNavTracker();
    tracker.record('https://bing.example/search');
    tracker.record('https://bing.example/ck/a');

    // The earlier target's echo arrives after the later one was recorded.
    expect(shouldResetHistoryForUrlProp('https://bing.example/search', tracker)).toBe(false);
    expect(shouldResetHistoryForUrlProp('https://bing.example/ck/a', tracker)).toBe(false);
  });

  it('treats each echo as single-use so a genuine later revisit still resets', () => {
    const tracker = new InternalNavTracker();
    tracker.record('https://a.example');

    expect(shouldResetHistoryForUrlProp('https://a.example', tracker)).toBe(false);
    // Same address arriving again is no longer an outstanding echo.
    expect(shouldResetHistoryForUrlProp('https://a.example', tracker)).toBe(true);
  });

  it('drops all pending echoes once an external change resets the host', () => {
    const tracker = new InternalNavTracker();
    tracker.record('https://a.example');
    tracker.clear();
    expect(shouldResetHistoryForUrlProp('https://a.example', tracker)).toBe(true);
  });

  it('bounds memory so a long redirect chain cannot grow without limit', () => {
    const tracker = new InternalNavTracker();
    for (let i = 0; i < 40; i++) tracker.record(`https://example.com/${i}`);

    // The most recent target is still recognised...
    expect(shouldResetHistoryForUrlProp('https://example.com/39', tracker)).toBe(false);
    // ...while a long-evicted one is not.
    expect(shouldResetHistoryForUrlProp('https://example.com/0', tracker)).toBe(true);
  });
});

/** A webview that has attached and is showing `guestUrl`. */
const attached = (guestUrl: string) => ({
  getURL: () => guestUrl,
  getAttribute: () => 'https://first.example',
});

/** A webview before dom-ready: getURL() throws, only the src attribute is readable. */
const unattached = (src: string | null) => ({
  getURL: (): string => {
    throw new Error('The WebView must be attached to the DOM and the dom-ready event emitted');
  },
  getAttribute: () => src,
});

/**
 * WebviewHost binds <webview src> to the first address only; an external url change
 * loads by assigning src, and only when the guest is not already there. Electron reloads
 * on every src assignment, so a spurious "yes" here replays the address — what turned
 * Kingdee K3's single sign-on into a login loop when src followed every navigation.
 */
describe('shouldLoadUrlProp', () => {
  it('does not load on mount, where src already carries the address', () => {
    expect(shouldLoadUrlProp('https://first.example', unattached('https://first.example'))).toBe(false);
  });

  it('does not reload when the guest is already on the incoming address', () => {
    expect(shouldLoadUrlProp('https://k3.example/index.aspx#', attached('https://k3.example/index.aspx#'))).toBe(false);
  });

  it('loads an external change after the guest navigated elsewhere', () => {
    // Guest moved from the first address to C; the same first address arriving again
    // is a genuine request to go back there.
    expect(shouldLoadUrlProp('https://first.example', attached('https://c.example'))).toBe(true);
  });

  it('loads when the webview is not attached yet and src differs', () => {
    expect(shouldLoadUrlProp('https://b.example', unattached('https://first.example'))).toBe(true);
    expect(shouldLoadUrlProp('https://b.example', unattached(null))).toBe(true);
  });
});
