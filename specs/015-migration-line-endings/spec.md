# Feature Specification: Windows Databases From 2.1.61-nexwork.1 Open in Later Builds

**Feature Branch**: `nex-work`
**Created**: 2026-10-23
**Status**: Implemented; reproduced and verified with real binaries on macOS; Windows installer check pending

## Why

On 2026-10-21 a Windows employee upgraded from `2.1.61-nexwork.1` to `2.1.61-nexwork.3`. aioncore
refused to start six times in a row with:

```text
bootstrap boundary failure code="BOOTSTRAP_DATA_INIT_FAILED" stage="database.migration"
error=Migration failed: migration 1 was previously applied but has been modified
```

The migration SQL never changed. Every NexWork release pins AionCore `v0.1.72` (commit `57a34cc`),
and all 42 migration files are byte-identical apart from line endings. The difference is how the
binary was produced:

| Release       | Windows `aioncore.exe`                                                           | Embedded migrations |
| ------------- | -------------------------------------------------------------------------------- | ------------------- |
| nexwork.1     | AionCore's official release asset (`sourceType: download`)                       | CRLF                |
| nexwork.2, .3 | built from source by `backendWorkspace.mjs` (`nexwork-source`, since 2026-09-10) | LF                  |

- AionCore's official Windows build checks the repository out with Git's line-ending conversion, so
  `sqlx::migrate!()` embeds the `.sql` files with CRLF.
- Our build clones with `core.autocrlf=false`, so it embeds them with LF.
- sqlx stores the SHA-384 of the embedded bytes in `_sqlx_migrations.checksum` and refuses a
  database whose stored checksum differs.

Measured on the release assets (2026-10-23):

- For all 42 migrations, the official exe contains the CRLF form of the source file and nexwork.3's
  exe contains the LF form.
- The official exe contains the SHA-384 digest of migration 001's CRLF form; nexwork.3's exe
  contains the digest of its LF form.

macOS is not affected: both builds embed LF.

The failure is not a one-off. Starting with nexwork.2, `migrateNexworkDirectory` renames `AionUi/`
to `NexWork/` on every launch where `AionUi/` is still a real directory. So a nexwork.1 Windows
database is carried into the new build every time someone upgrades, and nexwork.2 or .3 refuse it.
That holds for this employee too: they rolled back to nexwork.1 and are running on `AionUi\aionui`
again.

## Requirements

- **FR-1** aioncore accepts an applied migration whose stored checksum is sqlx's checksum of the
  same SQL with LF or CRLF line endings. Every other mismatch is still refused with
  `VersionMismatch`.
- **FR-2** The database is not modified: stored checksums stay as they are, so a rollback to the
  official-binary build (nexwork.1) can still open it.
- **FR-3** The fix lives in the reviewed AionCore source patch (`aioncore.patch`, renamed from
  `workspace-prefix.patch`), so every platform build carries it. Databases whose checksums already
  match take the unchanged path.

## Acceptance criteria

- [x] aionui-db unit tests:
  - a database stamped with CRLF checksums opens and keeps its checksums;
  - the embedded migrator alone refuses it with `VersionMismatch(1)`;
  - a checksum that matches neither form is still refused;
  - a matching database uses the embedded migrator.
  - The CRLF test fails with the tolerant migrator removed. All 749 aionui-db tests pass, and clippy
    reports nothing with `-D warnings`.
- [x] Real binaries on macOS, on a database whose `_sqlx_migrations` rows were stamped with the
      SHA-384 of each migration's CRLF form, which is what the official Windows exe embeds:
  - the unpatched build exits with the employee's exact error;
  - the patched build starts, and logs the 42 versions it accepted;
  - the patched build leaves the stored checksums unchanged;
  - with migration 1's checksum zeroed, the patched build still refuses it.
- [x] NexWork-Dev starts on the patched `darwin-arm64` build with its existing (LF) database.
- [ ] A Windows installer built from this commit opens a nexwork.1 database (CI build on the Windows
      runner, then an upgrade over nexwork.1 on a Windows machine).
