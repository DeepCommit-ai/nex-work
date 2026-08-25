# NexWork Constitution

NexWork is an internal product for our own staff. It is built on a fork of upstream
[AionUi](https://github.com/iOfficeAI/AionUi), which is periodically re-synced into this repository.

**This document replaces the upstream AionUi constitution.** Two of upstream's principles are
incompatible with what NexWork is for, and leaving them in place would make every NexWork spec fail
its own governance check. The specific reversals are recorded in _Deviations from Upstream_ below,
with the reasoning, so a future sync can resolve the conflict without re-deriving it.

## Core Principles

### I. The Server Decides

NexWork's value is that the system, not the user, works out what should happen: what the user is
actually trying to do, which model serves it, and how agents are scheduled.

- Decisions that could be made centrally are made centrally.
- The runtime that executes a task (which CLI, which model) is an implementation detail. Staff are
  not asked to choose it and are not shown it.
- A user-facing choice must earn its place. Every choice we surface is a decision the server did not
  make and a trajectory that teaches us nothing about our own routing.
- Users choose _what they want done_ (an assistant, a task). They do not choose _how it runs_.

**This inverts upstream principle I.** See _Deviations_.

### II. Data Collection Is the Point

The company has no consolidated digital record. Knowledge lives in individual heads, chats and local
files, so there is no corpus to index and no RAG-style system is possible. NexWork inverts that
dependency: staff do their normal work through the tool, and the corpus is produced as a by-product.

- Interaction trajectories are collected and aggregated into a company knowledge base.
- That knowledge base serves as a synced, company-level memory, and later as training data.
- Features are weighed on two axes, not one: user value **and** trajectory quality. A feature that
  moves work outside the tool — opaque handoffs, untracked side channels — loses the data that is the
  whole point.
- Collection is bounded by _Data Boundaries_ below. "The point" is not "without limit".

**This modifies upstream principle IV.** See _Deviations_.

### III. Minimal Upstream Drift

This repository re-syncs with upstream. Every line changed inside an upstream-owned file is a future
merge conflict.

- Prefer additive, ours-owned files: new modules, extension points, adapters, config, feature flags.
- When an upstream file must change, keep the diff small and localized — ideally one line that
  delegates to an ours-owned module. Do not refactor around it.
- Identifiers that other systems depend on are never renamed for cosmetic reasons: the `aioncore`
  binary's environment and data-directory contract, persisted keys, IPC channels, URL schemes,
  workspace names.
- Every deviation from upstream behaviour is recorded in the spec that introduced it.

### IV. Spec-Driven Change

Every change to this repository is recorded as a spec under `specs/` before the code, or alongside it
for work already in flight.

- `spec.md` states WHAT and WHY in user terms; `plan.md` states HOW, and must carry an
  upstream-drift accounting.
- Where a change deviates from upstream, the spec carries the rationale.
- A spec that conflicts with this constitution is resolved by amending one or the other — never by
  ignoring the conflict.

### V. Honest Verification

A change is done when it is verified, and claims about it match what was actually run.

- Failing tests are reported as failing, with output. Skipped steps are named as skipped.
- Static checks are not described as runtime verification. Unverified surfaces are listed as
  unverified.
- Hiding a control in the UI is not enforcement, and must not be described as enforcement.

### VI. Process Boundaries

Main-process code (`packages/desktop/src/process/`) uses no DOM APIs; renderer code
(`packages/desktop/src/renderer/`) uses no Node.js APIs. Cross-process communication goes through the
IPC bridge. This is a hard blocker, not a preference.

## Phase: Prototype

**NexWork is a prototype.** Shipping basic functionality quickly is the priority, and the
constitution is written to get out of the way until that stops being true.

While this clause stands:

- The data boundaries below are **suspended**. They are recorded, not enforced. No spec is blocked
  on them, no test gate is required for them, and no owner needs assigning.
- Principle II applies as intent, not as an obligation to have collection infrastructure built.
- Speed of iteration outranks completeness of governance. A spec may say "not yet" and move on.

**This clause ends when NexWork is used for real work by anyone outside the team building it.** At
that point the section below becomes binding as written, and the owners it names must be assigned
before collection continues. That is the trigger — not a date, not a version number.

## Data Boundaries (suspended — see Phase: Prototype)

Recorded now so the prototype is built in a shape that can honour them later, and so the exit from
prototype has a concrete checklist rather than a rediscovery exercise.

- **B-1 Redaction is pre-ingest.** Credentials, API keys, tokens and secrets are removed at the point
  of collection, before anything is written or transmitted.
- **B-2 Exclusion is enforced by test.** Every excluded category has a test that fails when it leaks.
- **B-3 Scope is work done inside NexWork.** Not the machine, not the person, not other applications.
- **B-4 Prompt content is in scope for redaction, not exempt from it.** A secret pasted into a prompt
  is the expected case, not a user error.
- **B-5 Disclosure precedes collection.** Staff are told, in the product, that their work is collected
  and what it is used for. Principle II removes the per-action consent prompt, not the disclosure.
- **B-6 The corpus is company-internal.** Trajectory data — the stored corpus, its aggregates, and
  anything trained on it — is not sent outside the company.
  **This is distinct from model execution:** sending a live interaction to an external model provider
  in order to answer it is how the product works and is not what B-6 governs.

Open decisions, unassigned by design while the prototype clause stands: retention period (U-1),
access roles (U-2), deletion process (U-3), audit evidence (U-4), incident procedure (U-5).

## Technology Standards

- **Processes**: Electron main + renderer, strictly separated (Principle VI).
- **Language**: TypeScript, strict mode. No `any`, no implicit returns. `type` over `interface`.
- **UI**: `@arco-design/web-react` components; no raw interactive HTML. Icons from `@icon-park/react`.
- **CSS**: UnoCSS utilities first, CSS Modules for complex cases. Colours come from semantic tokens,
  never hardcoded.
- **i18n**: All user-facing text goes through i18n keys. Brand values come from the branding module,
  not from literals in locale files.
- **State**: React Context + SWR. Backend-owned settings live in the backend, not in local files.
- **Package manager**: `bun` (`bun.lock` is the lockfile).

## Development Workflow

### Quality Gates

Hard blockers: process-boundary violations, TypeScript errors, failing tests, unsafe IPC usage,
missing i18n for new or changed user-facing text, raw interactive HTML in new UI.

Ordinary changes add focused tests for changed behaviour. Project coverage target is ≥ 80%.
Lint _warnings_ are pre-existing in volume and do not indicate failure; judge by exit code.

### Ratchet Rules

Existing directory-size or single-file-directory violations need not be cleaned up during ordinary
work, but a change must not make them worse. Plans and reviews must not invent cleanup scope the
user did not ask for.

### Branching

Work happens on `nex-work`, which is this fork's main branch. `main` tracks upstream and is kept
clean so syncs stay mechanical. AI agents do not push unless explicitly asked; when pushing, use
`just push`. Commits follow Conventional Commit format. **No AI signatures in commits or PRs.**

## Deviations from Upstream

| Upstream principle                                                                    | NexWork position                                                                                                                                            | Why                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I** — "Each AI agent integration must be independently manageable and configurable" | Reversed. The runtime is chosen centrally and hidden from staff (Principle I).                                                                              | Upstream is a general-purpose multi-agent client whose users _want_ to pick their CLI. NexWork is an internal tool for clerical staff, where exposing the CLI is a usability cost and a lost routing decision. The integrations remain independently manageable _by us_, in configuration — just not by the end user, in the UI. |
| **IV** — "No data transmission without explicit user consent"                         | Modified. Trajectory collection is a standing, disclosed condition of using the tool, not a per-action prompt (Principle II, bounded by _Data Boundaries_). | Upstream ships to individuals whose data is their own. NexWork is a company tool processing company work, where the collected corpus is the product's reason to exist. Per-action consent would make the corpus unusable and the tool unusable. Disclosure is retained; per-action consent is not.                               |
| **IV** — "Local storage of conversation history and settings"                         | Modified. History and settings remain local _and_ are aggregated centrally.                                                                                 | Same reason. The local-first behaviour is unchanged; central aggregation is added.                                                                                                                                                                                                                                               |

Upstream principles II (Modular Architecture First), III (User Experience Excellence) and V
(Developer Experience and Maintainability) are retained and are reflected above.

## Governance

- This constitution supersedes implementation preferences. A spec that conflicts with it is resolved
  by amending one or the other.
- Breaking changes require a migration plan recorded in the spec.
- Anything that would move a user's data location, orphan existing installs, or change what is
  collected requires an explicit decision recorded in the spec, not an incidental one.

**Version**: 2.0.0 | **Ratified**: 2026-08-25 | **Supersedes**: AionUi Constitution 1.0.0 (2025-01-22)
