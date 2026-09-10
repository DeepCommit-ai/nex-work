# NexWork assistant bootstrap

Product specification: `cynapse/doc/spec/2026-09-09-managed-nexwork-agents.md` in the sibling repository. Dedicated prompts and skills are maintained in `nex-agents/catalog`, published by cynapse, and installed by `process/services/managedagents`. This directory only supplies the minimal offline default and preserves retired identities for history.

`upstream.json` is the unmodified Apache-2.0 builtin assistant corpus from AionCore v0.1.72, commit `57a34cc1b1a3b17bcc023de06b9e6768fceac36f`. Source: https://github.com/iOfficeAI/AionCore/tree/v0.1.72/crates/aionui-app/assets/builtin-assistants . Preserve its license and attribution. The compressed payload maps relative filenames to base64 contents. All retired assistants stay disabled; the server defines the usable catalog.

`runtime.ts` prepares those resources before spawn and restores the required default after backend startup. It retains the last installed server catalog and optional assistant preferences. It never rewrites conversation history. The previous four-assistant snapshot migration has been retired.

`claudeProfile.ts` installs a neutral NexWork output style with coding-specific defaults disabled. Common rules and dedicated roles arrive through each conversation snapshot, so a global output-style update cannot replace an old conversation's role. This does not replace the vendor model identity or its entire system prompt.

The pinned backend intentionally omits localized names from user-owned definitions. The desktop decorates managed records with the published localization map. Conversation creation also resolves the current skills and MCP transports after acquiring a main-process catalog reservation; stale renderer form values cannot override a freshly installed publication.

When updating the backend pin, recheck the environment overrides, user assistant APIs, rule-file writer, omitted empty arrays, MCP `http` transport, conversation snapshots, and runtime skill materialization. Run the native integration check documented in the cross-repository spec.
