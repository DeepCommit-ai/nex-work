# NexWork tool branding

This overlay follows the owning specification in the sibling cynapse repository:
`doc/spec/2026-09-09-nexwork-four-assistants.md`.

`upstream.json` preserves the complete Apache-2.0 skill corpus from pinned AionCore
v0.1.72. Its source and license are recorded alongside the compressed files.
`resources.ts` changes product names, replaces the three application setup/help
guides, and supplies the backend's supported `AIONUI_BUILTIN_SKILLS_PATH` override.
The complete corpus is required because that override replaces the backend default
root. Third-party skill names and uppercase wire/environment tokens stay intact.

After backend schema/catalog initialization, `migration.ts` retires obsolete global
skill rows and migrates owned MCP metadata, assistant references, and workspace
links. It preserves MCP IDs, transport credentials, enablement, and user-authored
files. Backups precede changes; SQL and completed link moves roll back on failure.
Backend upgrades must recheck catalog synchronization, database fields, and skill
injection paths. The source corpus must be refreshed deliberately with that upgrade.

On macOS, `localApp.mjs` creates an isolated, ad-hoc signed NexWork development
launcher from the installed Electron runtime. Run it through `bun run start:local`;
it loads the repository build and migrates existing development data into the NexWork directory.
The launcher explicitly restores development mode before loading application code,
because Electron detects the renamed native bundle as packaged. It is not a distributable installer. Production bundles use electron-builder's
NexWork product/executable names. Never modify Electron's framework identifiers or
bypass the data-directory migration when changing the displayed application name.

`backendWorkspace.mjs` builds the pinned upstream commit with `workspace-prefix.patch`
and records the source, patch and binary hashes in the bundle manifest. The launcher
sets `NEXWORK_WORKSPACE_PREFIX=nexwork`; both conversation engines then create
`nexwork-temp-<conversation id>` directories using the original project binding and
cleanup logic. Existing workspace paths are retained. Prepare/build commands require
Rust 1.95.0 (CI installs it) and use a checksum-verified local binary cache. Version
or upstream Actions overrides must first receive a reviewed source patch; packaging
fails instead of silently losing the branding. Native macOS and Windows runners are
used for their respective installers; Rust handles the macOS architecture target.

`@aionui/web-host` shares `runtime/dataDirectories.ts` across the desktop and standalone launchers. It migrates owned desktop/standalone data roots before startup and
retains legacy aliases for historical absolute paths. A fresh desktop uses
`NexWork[-Dev[-2]]/nexwork`, with `~/.nexwork[-dev[-2]]` and
`~/.nexwork-config[-dev[-2]]` aliases on macOS. Standalone web hosts use the separate
`~/.nexwork-web[-dev[-2]]` root. Custom paths and conflicting existing data are
preserved. The backend database filename and legacy import/storage keys remain
protocol contracts; migration does not edit database contents or conversation paths.
