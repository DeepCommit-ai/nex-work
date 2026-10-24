# Plan: Windows Databases From 2.1.61-nexwork.1 Open in Later Builds

## Approach

- **Where.** sqlx's `Migrator::run` validates checksums itself and has no option to skip them, and
  the only owner of the embedded migrations is aioncore. So the fix goes into the AionCore source
  patch we already build every platform with, in `crates/aionui-db/src/database.rs`.
- **How.**
  - `run_migrations_with_retry` asks `line_ending_tolerant_migrator` for a migrator first. That
    function reads `_sqlx_migrations`. For each applied, non-down migration whose stored checksum
    differs from the embedded one, it recomputes the checksum with LF and with CRLF line endings
    (`Migration::new`, so no new dependency and an unchanged `Cargo.lock`).
  - On a match, the in-memory copy carries the stored checksum.
  - It returns `None` when nothing needed it, so a matching database takes upstream's path
    unchanged. The three `DB_MIGRATOR.run` calls in that function use the chosen migrator.
- **Why not re-stamp the rows.** Upstream re-stamps for migration 7 (`align_reconciled_mcp_migration_checksum`).
  Doing the same here would break a rollback to nexwork.1, which is what this employee did. Leaving
  the rows alone keeps both builds working on one database.
- **Not changed.** We keep building with LF instead of switching Windows to CRLF. Fresh Windows
  installs of nexwork.2 and .3 already store LF checksums, and the tolerant migrator accepts both.
- **Patch file.** `workspace-prefix.patch` becomes `aioncore.patch`, because it now carries two
  changes. `backendWorkspace.mjs` still verifies `git diff --binary` against it byte for byte, and
  the CI cache key follows the new name.

## Files

| File                                                                 | Owner    | Change                         |
| -------------------------------------------------------------------- | -------- | ------------------------------ |
| `packages/desktop/src/branding/tools/aioncore.patch`                 | ours     | renamed; `database.rs` +161 −4 |
| `packages/desktop/src/branding/tools/backendWorkspace.mjs`           | ours     | +3 −3                          |
| `packages/desktop/src/branding/tools/README.md`                      | ours     | +5 −2                          |
| `.github/workflows/_build-reusable.yml`                              | upstream | +1 −1 (cache key path)         |
| `specs/015-migration-line-endings/{spec,plan}.md`, `specs/README.md` | ours     | new, +1 index row              |

## Upstream drift

- The workflow line is the cache key of our own "Cache branded backend" step.
- The Rust change is a sync-back candidate for AionCore. Any build that mixes official Windows
  binaries with builds from a checkout that has no line-ending conversion hits it. Normalising line
  endings before checksumming (or a `.gitattributes` rule for `*.sql`) would fix it upstream.
- When the AionCore pin moves, `backendWorkspace.mjs` already refuses to build until the patch is
  reviewed against the new version.

## Verification

- `cargo +1.95.0 test --locked -p aionui-db` (749 passed) and
  `cargo clippy --locked -p aionui-db --tests -- -D warnings`.
- `node scripts/prepareAioncore.js` rebuilds `darwin-arm64` from the patch; the manifest records the
  new patch and binary hashes.
- End-to-end reproduction with the unpatched and patched binaries; see spec.md.
