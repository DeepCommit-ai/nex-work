# Plan: In-App Browser — One Driver, Awake While Driving

All changes are in the single-target bridge, `cdpBridge.ts`. The bridge already sees every client
socket, every page command and every discovery request. That makes it the one place that can tell
"another conversation is driving", and the one place that knows when the browser is in use and must
stay awake. Nothing in the renderer, the MCP launcher or chrome-devtools-mcp changes.

## Approach

- **Lease.** Module state `{ ws, lastActive }`, next to the existing `attached` and `sockets`.
  - `claimLease(ws)` runs on the two page paths, forward and `navigate-single-target`, after the
    existing unattached check. It hands the lease over in place when the previous holder is gone
    or idle, and re-arms an idle timer.
  - `refuseBusy` replies with `BROWSER_BUSY_MESSAGE`, then closes the socket after 100 ms (1013),
    so the error frame lands first and the client's next tool call reconnects cleanly
    (spec 007 FR-6's poisoned-`pagePromise` lesson).
  - Discovery checks `leaseHeldByOther(null)` before its existing branches.
  - The socket `close`/`error` handlers, the idle timer and `close()` release the lease.
- **Keep-awake and throttling.** A single `refreshBackgroundPolicy()` reconciles two outputs from
  two inputs (lease held, discovery waiting):
  - the platform power service (`getPlatformServices().power.preventSleep/allowSleep`, i.e.
    `prevent-app-suspension` in Electron, `null` in Node tests);
  - `setBackgroundThrottling` on the attached webContents. It restores the previous view when the
    attachment moves.

  It is called on every input change and on attach/detach. The power service is injectable through
  a new optional second argument to `startCdpBridge`, together with the idle window, which the
  tests need. The production call site is unchanged.

- **Diagnostics.**
  - The pending-discovery map now stores the start time, so answers and client closes log their
    latency.
  - The 10 s timer logs when it fires more than 5 s late.
  - Both 503s carry their guidance as an ASCII reason phrase, since puppeteer surfaces only
    `statusText`.
  - The timer literal stays `10_000`, because the existing timeout test intercepts that exact
    delay.

## Files

| File                                                             | Owner                            | Change       |
| ---------------------------------------------------------------- | -------------------------------- | ------------ |
| `packages/desktop/src/process/resources/builtinMcp/cdpBridge.ts` | upstream (with spec 007 patches) | +210 / −12   |
| `tests/unit/process/cdpBridgeLease.test.ts`                      | ours (new)                       | +208         |
| `tests/unit/process/cdpBridgeRuntimeEnable.test.ts` (FR-4)       | ours (new)                       | +139         |
| `specs/010-browser-bridge-busy-and-background/{spec,plan}.md`    | ours (new)                       | —            |
| `specs/README.md`                                                | ours                             | +1 index row |

## Upstream drift

- `cdpBridge.ts`: +210 / −12. About 150 of the added lines are one new block: lease state,
  `refreshBackgroundPolicy`, claim/release and bilingual rationale. It sits after the module state
  so a re-sync conflict stays in one hunk. The other hunks are small and anchored:
  - `refuseBusy` after `sendError`;
  - two 4-line gates in `handleSocketMessage`;
  - one `refreshBackgroundPolicy()` call each in `attachInternal` and `detachInternal`;
  - the socket `forget` handler;
  - `releaseLease` in `close()`;
  - the discovery handler: busy check, timing map and late-timer warning;
  - the `startCdpBridge` options parameter;
  - the `UNATTACHED_REASON` constant.

  Every hunk is marked `[ENTERPRISE PATCH] spec 010`. The behaviour change for upstream's
  single-conversation, visible-window case is limited to the 503 reason phrase.

- FR-4 (2026-10-21): one more anchored hunk in the forward path of `handleSocketMessage`,
  a `Runtime.disable` before a forwarded `Runtime.enable`, with its bilingual rationale; marked
  `[ENTERPRISE PATCH] spec 010 FR-4`. Upstream has the same shared session and the same defect.

## Verification

- Focused vitest run on the dev Mac: the new suite (4 tests) plus the three existing bridge suites,
  31/31 green.
- oxlint (0 errors) and oxfmt on the touched files; `tsc --noEmit` clean.
- `bun run package` rebuilt `out/`.
- Live checks are listed in spec.md's acceptance criteria.
