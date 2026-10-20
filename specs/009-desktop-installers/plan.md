# Installer release plan

Use the existing manual workflow and Electron builder. Add a desktop platform selection and a push trigger limited to changes to that workflow on `nex-work`, enabling the first build without changing the upstream default branch. Build Intel macOS on an Intel runner so backend resource preparation executes the correct architecture. Stop Windows jobs when native build commands fail.

Prepare Claude Code from the existing pinned platform-package downloader before packaging. Keep the existing resource validation hook. Extend the build harness to verify target architecture and failure propagation. Run repository checks before pushing, inspect build artifacts, smoke-test the macOS application locally, and attach installers with checksums and installation notes to a GitHub release.

## Upstream drift

- `scripts/build-with-builder.js`: two added lines connect the existing Claude preparation helper to distribution builds.
- `.github/workflows/build-manual.yml`: approximately 20 changed lines add NexWork defaults, a desktop matrix, a narrowly scoped push trigger, and a native Intel runner.
- `.github/workflows/_build-reusable.yml`: approximately 45 added lines propagate Windows command failure and smoke-test each packaged desktop application with isolated empty user data, a responsive bundled backend, and the existing enterprise settings form.
- `tests/unit/bootstrap/buildWithBuilder.test.ts`: 114 changed lines cover bundled Claude preparation and an unavailable-payload failure, including formatter indentation of the expanded parameterized test.

These changes close release blockers only. Branding, enterprise setup, backend APIs, and automatic-update behavior stay as implemented.

## Later releases

- The push trigger only fires when `build-manual.yml` itself changes. A change limited to `_build-reusable.yml` or application code needs `gh workflow run build-manual.yml -R DeepCommit-ai/nex-work --ref nex-work`.
- The build does not produce `SHA256SUMS.txt`; generate it from the downloaded installers before uploading.
- Pushing a release tag runs the upstream `Build and Release` workflow. Its Create Release job renames the release to the tag name and appends GitHub-generated notes; its build and distribution jobs are skipped because `PUBLISH_RELEASE` is unset. Title the release with the tag name and re-apply the written notes with `gh release edit --notes-file` after that run.
- Give every release its own app version so installers, the DMG volume and the About page tell releases apart: dispatch with `app_version` set to the tag without its `v` (e.g. `2.1.61-nexwork.2`). The input feeds upstream's existing build-time override (`AIONUI_DEBUG_AUTO_UPDATE_CURRENT_VERSION` in `scripts/build-with-builder.js`), which rewrites the root `package.json` version for the build and restores it, so `package.json` keeps the upstream version. Auto-update is disabled (`AUTO_UPDATE_ENABLED`), so nothing compares the prerelease version against upstream releases. The `branch` input accepts a commit, so a release can be rebuilt from its tagged commit with the current workflow.
- `v2.1.61-nexwork.2` (2026-10-20, `be76180a0`) is the first managed client release: it adds the bundled Python (spec 011) and the department Claude Code model (spec 012). Its installers were first published as `NexWork-2.1.61-*` and replaced the same day by a rebuild of the same commit stamped `2.1.61-nexwork.2`; `v2.1.61-nexwork.1` keeps the plain `2.1.61` names.

### Upstream drift (version stamping)

- `.github/workflows/build-manual.yml`: 6 added lines declare and forward the optional `app_version` input.
- `.github/workflows/_build-reusable.yml`: 10 added lines declare the input and pass it to the Windows, macOS and Linux build steps.
