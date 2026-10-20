# Feature Specification: In-App Browser Keeps Single Sign-On Sessions

**Feature Branch**: `nex-work`
**Created**: 2026-10-20
**Status**: Implemented; verified live on the dev Mac

## Why

The purchase requisition review assistant logs into Kingdee K3 through the Weaver OA portal in
the in-app browser. On 2026-10-20 that never worked. There were two separate defects, both in
upstream AionUi code that NexWork inherits.

1. **Login loop.** `WebviewHost` bound `<webview src>` to its `currentUrl` state, and
   `did-navigate` / `did-navigate-in-page` updated that state. Electron reloads a webview on every
   `src` assignment, even when the value equals the current address. So every address the page
   moved to was requested a second time. The dev log showed K3's single sign-on chain replayed
   address by address: `lightstartapp.aspx?ud=…` → `dform.aspx?…&_cnneptstate_=…` → `index.aspx`
   → `index.aspx#`. Each replay was a renderer `loadURL` aborted by the next one. The replayed
   one-time state token was rejected, and the `#` route reload reset the single-page app. K3 then
   returned to its login page after every login.
2. **Popup window.** Clicking K3 in the OA portal opened a standalone Electron window.
   - `WebviewHost` rewrites `window.open` only in the top frame, and the portal calls it from an
     iframe.
   - The webview carries `allowpopups="false"`. That is a boolean attribute, so it enables popups.
   - The window sat outside the side panel and off the single-target CDP bridge, so the agent
     could not see it and the employee did not know which window to use.

## Requirements

- **FR-1** A navigation the page makes itself (redirect, link, `#` route) is loaded exactly once.
  `WebviewHost` binds `src` to the first address only. Deliberate loads (address bar, intercepted
  link, external `url` change) assign `src` imperatively.
- **FR-2** An external `url` change loads only when the guest is not already on that address. This
  includes mount, where `src` already carries it, and React StrictMode's second effect run.
- **FR-3** A new-window request from a webview guest never opens a standalone window. An http(s)
  address loads in the originating webview; anything else is denied. This applies whatever the
  frame, link target or opener.
- **FR-4** Main windows keep Electron's default behaviour. So do webviews without `allowpopups`
  (HTML and PDF preview), which Electron refuses before any window-open handler runs.

## Acceptance criteria

- [x] `shouldLoadUrlProp`: no load on mount or when the guest is already there; load after the
      guest moved elsewhere or before attach with a different `src` (unit tests).
- [x] `installGuestWindowOpenPolicy`: http(s) loads in place and returns `deny`; `about:blank`
      and `javascript:` are denied without navigating; non-webview contents get no handler; a
      redirect's `ERR_ABORTED` rejection is swallowed (unit tests).
- [x] Live, NexWork-Dev on the dev Mac (2026-10-20): after FR-1 the dev log has no renderer
      `loadURL` replays of the K3 chain. After FR-3, clicking K3 in the OA portal opens it in the
      side panel without a popup. The K3 login holds (confirmed by the user).
- [ ] Packaged installers (`v2.1.61-nexwork.3`) on an employee machine.

## Upstream

Both defects are upstream (`cb9d8f19b`, AionUi #3826) and are candidates to send back at the next
sync. The fix keeps the component's structure. `src` stops following navigation state, and one
main-process policy covers every frame.
