# Feature Specification: The Installed Application Never Downloads or Replaces Itself at Run Time

**Feature Branch**: `nex-work`
**Created**: 2026-10-27
**Status**: Shipped in `v2.1.61-nexwork.8` (2026-10-27); the office-skill half reached every client with catalog
revision 8 the same day (cynapse managed-agents spec §23). Verified on a locally built Apple Silicon package and on the
released installers' contents. Windows not run.

## Why

### A. Browser tools vanish for a whole conversation

An employee on nexwork.7 (Apple Silicon, department `advance` on Kimi) asked the K3 purchasing
assistant for screen suppliers and prices. The assistant answered that `nexwork-browser` was not in
its tool list, retried, and finally told the employee to start a new conversation. Opening the
in-app browser by hand did not help.

Claude Code connects each MCP server once, when the session process starts, and waits at most
30 seconds (`Starting connection with timeout of 30000ms`). A server that misses the deadline is
dropped for the whole session. The browser server missed it because of how it started its real
work.

- `builtin-mcp-browser.js` ran `npx -y chrome-devtools-mcp@0.16.0` and proxied the MCP handshake
  to it. The installer did not contain chrome-devtools-mcp.
- npx contacts the npm registry on every start, even with the exact version already cached.
  Measured on this Mac with the sandbox's warm cache: 4.1 s when the registry answers. With the
  registry unreachable it was still waiting after 120 s, when the measurement killed it.
- So whenever an employee's network cannot reach registry.npmjs.org in time (mainland networks,
  company proxies, offline), the session has no browser tools. A first-time install also has to
  download the 2 MB tarball.

The investigation found two more problems on the same path.

- **Node chosen before it was unpacked.** The node that runs the browser server was chosen once
  per app start: PATH `node` if it and npx ran, otherwise aioncore's managed runtime under the data
  directory. On a fresh install that runtime is unpacked in the background. In the sandbox the
  choice was made 13 ms before the runtime finished. A slower machine without its own node gets
  bare `node`, which does not exist, until the next app start.
- **Node version not checked.** PATH `node` was accepted at any version. chrome-devtools-mcp
  0.16.0 requires `^20.19.0 || ^22.12.0 || >=23`.

### B. OfficeCLI's self-update stops NexWork from starting (nexwork.7)

OfficeCLI checks for a newer release every 24 hours, on any invocation. The Office preview and the
office skills both invoke it. When a newer release exists, OfficeCLI downloads it and replaces its
own executable (`Environment.ProcessPath`). On macOS the replacement happens at once. On Windows a
`.update` file is applied at the next invocation. Source: upstream
`src/officecli/Core/UpdateChecker.cs`, read 2026-10-27. It skips only with `OFFICECLI_SKIP_UPDATE=1`,
`autoUpdate false`, or a Homebrew/Scoop path.

Inside NexWork that executable is the pinned one, and nexwork.7 checks its SHA-256 before every
backend start. A mismatch throws from `spawnEnvironment`.

- **Simulated update.** A copy of the nexwork.7 release with one byte appended to the bundled
  `officecli` showed only "Startup failed — AionCore failed to start" (`aioncore process spawn threw
before startup`). Restarting does not help; only a reinstall does.
- **Not triggered yet.** OfficeCLI's latest release on 2026-10-27 was still 1.0.158, the pinned
  version. The next release starts the clock on every nexwork.7 machine that runs OfficeCLI.
- **Not verified.** That macOS lets OfficeCLI rewrite `/Applications/NexWork.app` was not tested.
  The Windows installer is per-user (`oneClick: false`, no `perMachine`), so its directory is
  writable.

### C. Startup held for 30 s without npm

When `npx` is not on PATH, which is the usual case for a Finder-launched Mac, an upstream startup
step tests the disabled `chrome-devtools` server. That test runs `npx chrome-devtools-mcp@latest`.
With the registry unreachable, `ensureBootstrapMcpServersInDb` took 30375 ms and 30293 ms, and
managed-catalog work after it waited too.

### D. Claude Code calls Anthropic directly

With all outside traffic dropped, a stream-json session of bundled Claude Code 2.1.235 finished its
first turn in 0.8 s. It still tried `api.anthropic.com:443` every 10–30 s: telemetry and error
reports, outside the company gateway. With `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` no outside
connection was attempted.

## Reproduction of A (2026-10-27, Apple Silicon, packaged builds, department `advance`, K3 assistant)

Both runs used:

- the same sandbox data directory (`AIONUI_E2E_TEST=1` + `AIONUI_E2E_USER_DATA_DIR`);
- a Finder-like PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) and an empty HOME;
- `npm_config_registry=http://10.255.255.1/`, which is unreachable.

| Build                                                                       | Browser MCP connection                                   | Assistant                                                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| nexwork.7 release DMG                                                       | `connection timed out after 30000ms`                     | 15 empty `Bash true` calls, then "本次复查未能成功完成"                                                            |
| This change, built locally with `build-with-builder.js arm64 --mac --arm64` | `Using bundled chrome-devtools-mcp`, connected in 604 ms | `evaluate_script`, `navigate_page` ×2, `take_snapshot`; opened the OA login page and asked the employee to sign in |

Without the registry block, the nexwork.7 release connected in 2.1 s on this Mac. The failure
depends on the network, which fits a report from one machine and not from others. The reporting
machine's own logs were not collected. This reproduces the symptom, but it does not prove that
the reporting machine failed for the same reason.

## Requirements

Browser tools (A):

- **FR-1** The build downloads `chrome-devtools-mcp` at the version pinned in `package.json`
  `bundledBrowserMcp` (name, version, npm sha512 integrity). It tries registry.npmjs.org, then
  registry.npmmirror.com, and rejects any tarball whose integrity differs. It extracts the package
  into `resources/bundled-browser-mcp/` with a manifest of per-file SHA-256 hashes. Unsafe tarball
  paths and entry types other than files and directories are rejected.
- **FR-2** electron-builder ships `bundled-browser-mcp`. afterPack re-hashes every file and fails
  the build when the payload is missing or differs.
- **FR-3** The main process passes the shipped entry to the backend as
  `NEXWORK_CHROME_DEVTOOLS_MCP`. aioncore and Claude Code pass it on to the browser server.
  - In packaged builds, a manifest that does not match the pin, or a missing entry, logs an error
    and leaves the variable unset. The app still starts.
  - In development checkouts the variable is set only when the bundle has been prepared.
- **FR-4** With the variable set, the browser server starts chrome-devtools-mcp as
  `<its own node> <entry> --browser-url <url>` on every platform: no npx, no `cmd.exe`, no
  network. Without it, the previous npx command is unchanged.
- **FR-5** In packaged builds the browser server runs on the node shipped inside the app
  (`bundled-aioncore/<platform>-<arch>/managed-resources`, located through its manifest). It is
  used when it runs and meets the version floor, without waiting for the data-directory runtime or
  consulting PATH. Otherwise the previous ladder applies.
- **FR-6** Every node probe rejects versions below chrome-devtools-mcp's engine range. The probe
  for the shipped node does not require npx.
- **FR-7** The pinned version equals `CHROME_DEVTOOLS_MCP_VERSION` in the browser server, so a
  development fallback through npx starts the same code.

OfficeCLI (B):

- **FR-8** The backend environment always carries `OFFICECLI_SKIP_UPDATE=1`. Every OfficeCLI
  started under NexWork, including the Office preview, never checks for, stages, or applies an
  update, and never refreshes skills into agent directories.
- **FR-9** A bundled OfficeCLI that is missing, changed, or of another version is logged and kept
  off PATH. It no longer throws from `spawnEnvironment`, so the backend still starts.
- **FR-10** The managed office skills (`officecli-docx/pptx/xlsx` in nex-agents) tell the
  assistant to run `officecli config autoUpdate false` before its first OfficeCLI command. Once
  the catalog is published this reaches nexwork.7 machines too. Measured with the bundled 1.0.158:
  after that command, `create` made no outside connection.

Startup and background traffic (C, D):

- **FR-11** The migration skips the upstream `chrome-devtools` preflight when that server is
  disabled.
- **FR-12** The backend environment carries `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` for every
  Claude Code session.
- **FR-13** The build test stubs the OfficeCLI prepare step as it does the others. The real step
  had been downloading other architectures into `resources/`, and a later local build shipped them
  (+33 MB in a local arm64 DMG).

## Behaviour by version

- **nexwork.7 and earlier**: only FR-10 reaches them, after the catalog is published, and only as an
  instruction to the assistant. A machine whose OfficeCLI already replaced itself needs this
  release (or a reinstall), which restores the pinned binary.
- **Conversations created before an in-place upgrade** keep their MCP transport snapshot. Its
  script path is the same file inside the upgraded app, so it runs the new launcher and uses the
  bundle. Its node stays the data-directory runtime recorded at creation, which works.
- **Conversations created after the upgrade** use the shipped node and the bundle.
- **A moved or second copy of the app.** Old conversations keep their old app's script, as they
  did before this change. In the A/B test, the old conversation in run B still used the nexwork.7
  copy and timed out. Only new conversations are evidence for this change.

## Residuals

- Windows: the spawn plan, node probes and OfficeCLI environment are unit-tested for `win32`. No
  Windows package was run.
- The data-directory runtime remains the fallback, so the unpacking race in A still applies when
  the shipped node cannot run.
- Assistants may still decide to `pip install` or `npm install` something on their own. Nothing
  in the managed catalog asks for it. The office skills' "if `officecli` is missing" install
  commands remain as a fallback.
