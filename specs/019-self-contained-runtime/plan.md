# Plan: The Installed Application Never Downloads or Replaces Itself at Run Time

## Approach

- **Pin (FR-1, FR-7).** `package.json` `bundledBrowserMcp` holds the name, version and npm `dist.integrity`
  of chrome-devtools-mcp 0.16.0. A unit test reads the launcher source and requires the same version.
- **Build-time payload (FR-1).** `packages/shared-scripts/src/prepare-browser-mcp.js` follows
  `prepare-officecli.js`: verify an existing bundle, otherwise download from two origins and check the
  integrity. The tarball is read with `zlib` and a small ustar reader that understands pax paths, so
  the build does not depend on the `tar` package. The package is self-contained (its dependencies
  live in `build/node_modules`). The bundle is written through a staging directory and renamed into
  place. Run directly with `node packages/shared-scripts/src/prepare-browser-mcp.js` for a
  development checkout.
- **Packaging (FR-2).** `build-with-builder.js` calls it after OfficeCLI; `electron-builder.yml`
  ships `resources/bundled-browser-mcp`; `afterPack.js` calls `verifyBrowserMcp`.
- **Runtime hand-off (FR-3).** `branding/tools/browserMcpRuntime.ts` checks the manifest against the
  pin and returns `{ NEXWORK_CHROME_DEVTOOLS_MCP: <entry> }` for `spawnEnvironment`, next to
  `officeRuntimeEnvironment`. Unlike OfficeCLI it never throws, because a broken bundle must not
  stop the whole backend.
- **Launcher (FR-4).** `buildMcpSpawnCommand` (upstream file) gains optional `bundledEntry` and
  `execPath`. `browserServer.ts` passes the variable and `process.execPath`, and logs which path
  it took. The upstream npx branch is untouched.
- **Node choice (FR-5, FR-6).** `mcpNodeCommand.ts` (our spec 007 file) gains `readBundledNode`,
  `probeBundledNodeWorks` and a version floor shared by both probes. `resolveMcpNodeCommand` tries
  `bundledNode` first, with source `bundled`. `runBackendMigrations.ts` passes it only when packaged,
  and no longer warns for `bundled`.
- **OfficeCLI (FR-8, FR-9).** `officeRuntimeEnvironment` returns `OFFICECLI_SKIP_UPDATE=1` on every path. Its
  checksum and version checks moved into a `try`: on failure it logs and returns only that variable, so the
  unverified binary stays off PATH and `spawnEnvironment` cannot throw.
- **Catalog (FR-10).** nex-agents adds one paragraph to the Setup section of each officecli skill. cynapse
  publishes it; no client change is needed for it to apply.
- **Preflight (FR-11).** `ensureBuiltinChromeDevtoolsAvailability` returns early for `enabled === false`.
- **Claude background traffic (FR-12).** `claudeProfile.ts` exports `NEXWORK_CLAUDE_PROCESS_ENV`, spread
  last in `spawnEnvironment`. It is a process variable rather than a `settings.json` entry, so the
  absence of outside calls can be checked with `ps` and the blackhole proxy.
- **Hermetic build test (FR-13).** `buildWithBuilder.test.ts` stubs `prepare-officecli.js` and asserts
  its call.

## Files

| File                                                                     | Owner           | Change                                                |
| ------------------------------------------------------------------------ | --------------- | ----------------------------------------------------- |
| `package.json`                                                           | shared          | +5 (pin)                                              |
| `.gitignore`                                                             | shared          | +1                                                    |
| `packages/shared-scripts/src/prepare-browser-mcp.js`                     | ours            | new                                                   |
| `packages/desktop/src/branding/tools/browserMcpRuntime.ts`               | ours            | new                                                   |
| `packages/desktop/src/index.ts`                                          | upstream        | spawnEnvironment +1 entry (reads pins once)           |
| `packages/desktop/src/process/resources/builtinMcp/browserServerPort.ts` | upstream        | +5, additive options                                  |
| `packages/desktop/src/process/resources/builtinMcp/browserServer.ts`     | upstream        | +7                                                    |
| `packages/desktop/src/process/utils/mcpNodeCommand.ts`                   | ours (spec 007) | bundled node, version floor                           |
| `packages/desktop/src/process/utils/runBackendMigrations.ts`             | upstream        | +4 −2                                                 |
| `packages/desktop/electron-builder.yml`                                  | upstream        | +3                                                    |
| `scripts/build-with-builder.js`, `scripts/afterPack.js`                  | upstream        | +3, +7                                                |
| `tests/unit/branding/tools/browserMcpRuntime.test.ts`                    | ours            | new                                                   |
| `tests/unit/process/mcpNodeCommand.test.ts`                              | ours            | bundled node, floor, real `exit` in the probe sandbox |
| `tests/unit/preview/browser/serverPort.test.ts`                          | upstream        | +2 cases                                              |
| `tests/unit/bootstrap/buildWithBuilder.test.ts`                          | upstream        | stub + assert the new prepare step                    |
| `packages/desktop/src/branding/tools/officeRuntime.ts`                   | ours            | skip update, non-fatal checks                         |
| `packages/desktop/src/branding/assistants/claudeProfile.ts`              | ours            | +7                                                    |
| `tests/unit/branding/tools/officeRuntime.test.ts`                        | ours            | new contract                                          |
| `tests/unit/bootstrap/runBackendMigrations.test.ts`                      | upstream        | +1 case pair                                          |
| `tests/unit/branding/assistants/assistantUpgrade.test.ts`                | ours            | +3                                                    |
| nex-agents `catalog/skills/officecli-{docx,pptx,xlsx}.md`                | nex-agents      | +2 each                                               |

## Upstream drift

Upstream files get additive, optional parameters and one extra spawn-environment entry. The npx
path and Windows `cmd.exe /d /c` handling stay byte-for-byte, so an upstream sync only has to keep
the two optional fields on `buildMcpSpawnCommand`, the `bundledEntry` argument at its call site, and the
`enabled === false` early return in the chrome-devtools preflight.
