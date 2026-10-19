# Plan: Bundled Python for Managed Skills

The interpreter follows the bundled Claude Code path end to end: pinned in the root `package.json`,
prepared at build time into `resources/`, copied by `extraResources`, verified in afterPack, and
wired into the Claude Code agent at start through the same aioncore overrides write.

## Approach

- **Preparation** (`packages/shared-scripts/src/prepare-python.js`, beside `prepare-aioncore.js`;
  `scripts/` is already over the directory limit).
  - Maps `<platform>-<arch>` to the python-build-standalone triple and builds the asset name from the
    pin.
  - Downloads with curl (PowerShell on Windows), like `prepare-aioncore.js`, into a staging
    directory beside the destination. Checks the SHA-256, extracts with `tar`, prunes, and moves the
    result into place with a same-filesystem rename.
  - When the target matches the build host, runs the interpreter once to import the modules skills
    use. Writes `VERSION` (`<version>+<release>`) last; an up-to-date bundle is skipped.
  - Pruning rules are data (`pruneRules`), one set for the Unix layout and one for Windows.
- **Build**: `build-with-builder.js` calls it right after `prepareClaude`; `electron-builder.yml`
  copies `resources/bundled-python` like the other bundled runtimes. As with them, CI builds one
  architecture per job; a local multi-architecture build would carry both bundles.
- **Verification**: `afterPack.js` requires the interpreter and `VERSION` for the target.
- **Runtime** (`packages/web-host/src/managed-claude.ts`):
  - `resolveBundledPythonCandidates` uses the two layouts already used for Claude Code: sibling of
    `bundled-aioncore`, then the repo-root dev fallback.
  - `withBundledPython` upserts or removes `NEXWORK_PYTHON`.
  - `provisionManagedClaude` includes the result in its single overrides PUT and treats a changed
    entry as a reason to write.
  - `buildEnvOverride` (gateway) already preserves entries it does not own, so no change there.

## Files

| File                                                         | Owner                          | Change                        |
| ------------------------------------------------------------ | ------------------------------ | ----------------------------- |
| `packages/shared-scripts/src/prepare-python.js`              | ours (new)                     | +194                          |
| `tests/unit/assets/preparePython.test.ts`                    | ours (new)                     | +158                          |
| `packages/web-host/src/managed-claude.ts`                    | ours (enterprise patch file)   | +49 / −3                      |
| `packages/web-host/src/managed-claude.test.ts`               | ours                           | +104 / −1                     |
| `package.json`                                               | upstream                       | +12 (new `bundledPython` key) |
| `scripts/afterPack.js`                                       | upstream (with issue #8 patch) | +11                           |
| `scripts/build-with-builder.js`                              | upstream (with issue #8 patch) | +3                            |
| `packages/desktop/electron-builder.yml`                      | upstream                       | +3                            |
| `tests/unit/bootstrap/buildWithBuilder.test.ts`              | upstream                       | +5                            |
| `.gitignore`                                                 | upstream                       | +1                            |
| `specs/011-bundled-python/{spec,plan}.md`, `specs/README.md` | ours                           | new, +1 index row             |

## Upstream drift

All upstream edits are additions; no upstream line is modified.

- `package.json`: one new top-level key next to the existing `claudeCodeVersion` pin.
- `afterPack.js`: one block appended to `verifyBundledResources`, after the bundled Claude Code
  check it mirrors.
- `build-with-builder.js`: three lines after the `prepareClaude` call.
- `electron-builder.yml`: one `extraResources` entry after `bundled-claude`.
- `buildWithBuilder.test.ts`: one require stub so the harness never downloads, and one assertion.
- `.gitignore`: one path.

## Verification

- Focused vitest: the new suite and `managed-claude.test.ts` (25 tests), plus `tests/unit/bootstrap`
  and `tests/unit/assets` (162 passed, 1 skipped), on the dev Mac.
- oxlint (0 errors), oxfmt on the touched files, `tsc --noEmit` clean.
- Real darwin-arm64 bundle prepared and exercised against the purchase skill (see spec.md).
