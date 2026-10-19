# Feature Specification: In-App Browser — One Driver, Awake While Driving

**Feature Branch**: `nex-work`
**Created**: 2026-10-19
**Status**: Implemented; focused tests green; live checks listed below

## Why

Found during the first hands-on run of the purchase-requisition review assistant in NexWork-Dev
(2026-10-19). Every piece of browser work in that assistant goes through the single-target CDP
bridge (`cdpBridge.ts`, spec 007), so its defects decide how fast and how safely the agent works.

### D1 — the first browser call hung for five minutes

`list_pages` took 302 s and failed with `Failed to fetch browser webSocket URL from
http://127.0.0.1:54935/json/version: fetch failed` (chrome-devtools-mcp log). That is undici's
300 s header timeout: discovery got no answer at all. The bridge answers discovery synchronously
when attached and within a 10 s timer when not. The attached path is not the problem: probed
every 5 s for 90 s with NexWork hidden, it answered in 1–6 ms. The only path that depends on a
timer is the unattached wait, and NexWork was hidden at the time (desktop automation had hidden
its window). macOS App Nap defers the timers of hidden apps. A deferred 10 s timer, plus a view
that does not attach while hidden, produces exactly a silent 300 s wait. This mechanism is
inferred, not reproduced; FR-3 makes the next occurrence identify itself.

### D1b — the retry guidance never reached the agent on the discovery path

When discovery does give up with 503, puppeteer reports only `HTTP Service Unavailable`: it reads
`statusText` and discards the body. The retry guidance from spec 007 FR-7 ("wait a few seconds and
retry the same tool call") was therefore invisible on this path. The agent saw a generic failure
and improvised.

### D2 — conversations stomp on each other's page

Each conversation spawns its own chrome-devtools-mcp, while the bridge serves one webContents. Two
conversations driving at once navigate each other's page away mid-task. A common case is the user
comparing two assistants side by side. Neither agent nor the user gets any signal. Giving each
conversation its own browser is deliberately out of scope here (deferred); this spec only makes
sharing safe and visible.

### D3 — a hidden window slows the page down

With the window hidden, Chromium throttles the page's timers, and throttles them more heavily after
five minutes. In-page batches poll with `setTimeout`, such as the review assistant's
`__k3.runBatch`, so they slow down whenever the employee looks at another app.

## Functional Requirements

- **FR-1** One conversation drives the page at a time.
  - The connection that most recently sent a page command (anything forwarded to the webview, or
    `Target.createTarget`'s navigation) holds a lease.
  - A page command from any other connection while the lease is live is refused with
    `BROWSER_BUSY_MESSAGE`. The message tells the agent that another conversation is using the
    browser, to tell the user, and to retry once that conversation is done. The bridge then closes
    that socket (1013), because a refused page initialisation is cached by puppeteer forever
    (spec 007 FR-6) and only a reconnect clears it.
  - A new client's discovery while the lease is live gets a 503 whose reason phrase carries the
    same guidance.
  - The lease ends when its holder disconnects, or after `LEASE_IDLE_MS` (60 s) without a page
    command. A finished conversation therefore never holds the browser.
  - Locally answered `Target.*` commands never touch the page and stay ungated, so handshakes
    always complete.
- **FR-2** The app stays awake only while the browser is in use, which means while a lease is
  held or a discovery request is waiting for the panel to attach.
  - App Nap is blocked through the platform power service (`prevent-app-suspension`).
  - The attached webview is exempt from background throttling (`setBackgroundThrottling(false)`).
  - Both revert as soon as neither condition holds. Changing which tab is attached moves the
    exemption with it, and the previous view is restored.
- **FR-3** Discovery explains itself.
  - Unattached 503s put the retry guidance in the HTTP reason phrase, which is what puppeteer
    shows. The body is kept for other clients.
  - Every waited discovery logs `[CDP] Discovery waiting …`, then either `answered 200|503 after
N ms` or `closed by the client after N ms`.
  - A discovery timeout that fires more than 5 s late logs a warning naming suspension as the
    likely cause.
  - Lease changes log `[CDP] Browser lease taken / released (why)`.

## Acceptance Criteria

- [x] Focused tests, `tests/unit/process/cdpBridgeLease.test.ts`:
  - a second connection's page command is refused with the busy message and closed (1013), while
    its `Target.*` handshake is still answered;
  - a new discovery during the lease gets 503 with "another conversation" in `statusText`;
  - the holder keeps driving undisturbed;
  - when the holder disconnects, keep-awake stops and throttling is restored, and a new client
    can drive;
  - an idle lease is released while its holder is still connected, and the old holder then
    becomes the outsider;
  - keep-awake covers a waiting discovery and ends when it is answered, both for a 503 (with
    "retry the same tool call" in `statusText`) and for a 200.
- [x] Existing bridge suites are unchanged and green: `cdpBridgeClientReset`,
      `cdpBridgeKeyboardFocus`, `cdpBridgeSessionRouting`.
- [x] Gates: oxlint 0 errors on the touched files, oxfmt clean, `tsc --noEmit` clean.
- [ ] Live: with NexWork-Dev hidden, the first browser call either attaches or returns the
      "not attached yet … retry" text within about 10 s, never a 300 s hang; the main log shows
      the `[CDP] Discovery …` lines.
- [ ] Live: two conversations. While one drives K3, the other's browser call returns the busy
      text and the first conversation's page is untouched; one minute after the first goes quiet,
      the second can drive.

## Boundaries

- This is not a per-conversation browser. The page is still shared; the lease only makes the
  sharing explicit.
- The lease belongs to a socket, not a conversation. A tab switch resets every client (spec 007
  FR-6), and the lease goes to whichever conversation reconnects first. That is acceptable,
  because a tab switch is the user's own action in the panel.
- 60 s idle is a trade-off. Shorter, and a slow model turn (writing a long script, thinking)
  could lose the page to a concurrent conversation. Longer, and a conversation that has just
  finished blocks the next one for longer. The busy text tells the agent to retry after a minute
  when nothing else is running.
- D1's root cause is inferred, not reproduced. FR-2 removes the suspected mechanism; FR-3 confirms
  or refutes it on the next occurrence.

## Deviation rationale (upstream)

`cdpBridge.ts` is upstream AionUi carrying spec 007's enterprise patches. Upstream has the same
single-target sharing and the same timer dependency, so FR-1 to FR-3 are candidates for
contribution. They change no behaviour for a single conversation with a visible window, apart from
better 503 text.

## Relationship to other specs

- Spec 007 FR-5/FR-6/FR-7 still apply: the panel auto-opens on first use, clients are reset on a
  genuine attachment change, and `new_page` navigates the single page. FR-1 reuses FR-6's
  reconnect-to-clear logic for refused clients.
- The purchase-review skill (nex-agents `agents/purchase-req-review/SKILL.md`) tells its agent what
  to do with both texts: retry on "not attached yet"; tell the user and wait on "in use by another
  conversation".
