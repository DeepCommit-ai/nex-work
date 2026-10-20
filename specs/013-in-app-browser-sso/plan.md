# Plan: In-App Browser Keeps Single Sign-On Sessions

## Approach

- **Login loop (FR-1, FR-2).** `WebviewHost` renders `src={initialSrc}`, the address from mount,
  which never changes. `did-navigate` still updates `currentUrl`, but that state now drives only the
  address bar, `onUrlChange` and the StarOffice checks. `navigateToWithHistory` already assigned
  `webviewEl.src` imperatively, so it stays as it is. The reset effect for an external `url` change
  assigns `src` itself, and only when `shouldLoadUrlProp` says the guest is elsewhere.
  - That check reads `getURL()`, which throws before dom-ready, and falls back to the `src`
    attribute. So mount and StrictMode never load twice.
- **Popup (FR-3, FR-4).** `installGuestWindowOpenPolicy(app)` listens on `web-contents-created`. For
  `getType() === 'webview'` it sets a window-open handler: http(s) addresses go to the same
  contents' `loadURL`, with the redirect's `ERR_ABORTED` swallowed; every request returns `deny`.
  It is registered at the top level of `index.ts`, before any window exists.
  - The injected top-frame `window.open` rewrite stays. It handles the common case before Electron
    is involved.
  - The `allowpopups` attribute stays too, because removing it would stop the handler from ever
    running.

## Files

| File                                                                   | Owner    | Change            |
| ---------------------------------------------------------------------- | -------- | ----------------- |
| `packages/desktop/src/renderer/components/media/WebviewHost.tsx`       | upstream | +26 −4            |
| `packages/desktop/src/renderer/components/media/webviewHistory.ts`     | upstream | +29               |
| `packages/desktop/src/index.ts`                                        | upstream | +5                |
| `packages/desktop/src/process/resources/builtinMcp/guestWindowOpen.ts` | ours     | new               |
| `tests/unit/preview/browser/webviewHistory.test.ts`                    | upstream | +46 −1            |
| `tests/unit/process/guestWindowOpen.test.ts`                           | ours     | new               |
| `specs/013-in-app-browser-sso/{spec,plan}.md`, `specs/README.md`       | ours     | new, +1 index row |

## Upstream drift

- `WebviewHost.tsx`: the `src` binding, one state line and the guarded load in the reset effect,
  plus the bilingual comments that explain why `src` must not follow navigation. This is a bug fix
  upstream should take.
- `webviewHistory.ts`: adds `shouldLoadUrlProp` next to the existing echo decision, so the choice is
  testable without mounting a `<webview>` (which jsdom cannot do).
- `index.ts`: one import and one call next to `installGpuCrashHandler()`.
