# NexWork Specs

Every change to this repository is recorded as a spec here before (or, for work already in flight,
alongside) the code. This uses the **spec-kit** layout the repo already ships in `.specify/`:

```
specs/<NNN>-<feature-name>/
  spec.md     WHAT and WHY  — user-facing behaviour, requirements, acceptance criteria
  plan.md     HOW           — technical approach, files touched, upstream-drift accounting
  tasks.md    steps         — only when the work is large enough to need sequencing
```

Templates live in `.specify/templates/`. Numbers are allocated in order and never reused.

## Rules specific to this fork

This repo is a fork of upstream **AionUi** that is periodically re-synced. Two extra requirements
therefore apply to every spec:

1. **Upstream-drift accounting.** `plan.md` must list every upstream-owned file the change touches
   and the number of lines changed in each, with a justification for anything beyond a couple of
   lines. Additive, ours-owned files do not need justification.
2. **Deviation rationale.** Where the change deliberately diverges from upstream behaviour, the spec
   records why — so a future sync conflict can be resolved without re-deriving the reasoning.

## Index

| Spec                                              | Title                               | Status                   |
| ------------------------------------------------- | ----------------------------------- | ------------------------ |
| [001](001-nexwork-rebrand/spec.md)                | AionUi → NexWork rebrand            | Implemented, uncommitted |
| [002](002-server-controlled-capabilities/spec.md) | Server-controlled capability policy | Draft (rev 2)            |
| [003](003-nexwork-constitution/spec.md)           | NexWork constitution                | Implemented, in review   |
| [004](004-app-icon-geometry/spec.md)              | App icon geometry                   | Implemented              |
