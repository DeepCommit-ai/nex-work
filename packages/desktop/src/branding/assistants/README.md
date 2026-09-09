# NexWork assistant resources

Product specification: `cynapse/doc/spec/2026-09-09-nexwork-four-assistants.md` in the sibling repository. Desktop-only Node entry points are `runtime.ts`, `migration.ts`, and `claudeProfile.ts`; the policy, department adapter, prompts and metadata are process-agnostic.

`upstream.json` contains a deterministic gzip snapshot of the unmodified builtin assistant directory from **AionCore v0.1.72**, commit `57a34cc1b1a3b17bcc023de06b9e6768fceac36f`, licensed under Apache-2.0. Source: https://github.com/iOfficeAI/AionCore/tree/v0.1.72/crates/aionui-app/assets/builtin-assistants . Preserve upstream license and attribution when distributing this corpus.

The compressed JSON is a map from relative filenames to base64 file contents. The outer file records its source and license. This keeps the complete offline baseline together, including avatars and rules needed by disabled assistants and historical sessions. `runtime.ts` expands it and changes only the retained four assistants plus the legacy alias. Do not edit the compressed payload to author prompts: edit `prompts.ts` and `metadata.json`.

When changing the pinned backend, regenerate the snapshot from its complete builtin-assistants directory (sorted filenames, JSON UTF-8, gzip mtime 0). Verify the environment override, catalog schema, state API, database columns used in `migration.ts`, and assistant-to-engine prompt routing against that exact backend version. Update the baseline test in the same change.

Before backend spawn, materialize the versioned resources. After the backend takes ownership, copies any legacy database and upgrades its schema, migrate product-owned builtin profile copies, stored assistant snapshots and the actual runtime rules in conversation extra; complete this before desktop readiness. Migration validates every row before changing files and writes a private backup of changed fields and planned file moves under `nexwork-resources/migration-backups`; messages, models, permissions and inactive assistant content remain unchanged. Backend-owned retired workspace skill links or identical copies move to `nexwork-disabled-skills`; user-modified copies are preserved. Native Aion workspaces use `.aionrs/skills`. A migration error rolls back both the SQL transaction and completed file moves.

The managed Claude output style changes the main conversation's default office role. It is not a claim that the vendor's whole system prompt or model identity was replaced. Workspace instructions and user-authored agents remain normal user inputs.
