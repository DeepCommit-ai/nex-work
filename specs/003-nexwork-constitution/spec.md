# Feature Specification: NexWork Constitution

**Feature Branch**: `nex-work`
**Created**: 2026-08-25
**Status**: Implemented, revision 3 — data boundaries suspended for the prototype phase
**Input**: "把上游宪法改成 nexwork 宪法"

## Why

The repo ships spec-kit, and spec-kit validates every spec against
`.specify/memory/constitution.md`. That file was upstream's **AionUi Constitution 1.0.0**, and two of
its principles are incompatible with what NexWork is for:

| Upstream                                                                             | Conflict                                           |
| ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| §I "Each AI agent integration must be **independently manageable and configurable**" | NexWork hides CLI choice from staff (spec 002)     |
| §IV "**No data transmission without explicit user consent**"                         | Trajectory collection is NexWork's reason to exist |

Left in place, every NexWork spec would fail its own governance check on day one. A governance
document that is routinely violated stops being governance, so this had to be resolved rather than
ignored.

## Decision

Replace the file rather than layer an amendment on top of it. The constitution is a single
low-churn file with near-zero merge value from upstream, and spec-kit reads that exact path — an
overlay would have to be manually honoured by every reader, which is how governance documents
quietly stop being followed.

## What the new constitution says

Six principles: **I. The Server Decides** · **II. Data Collection Is the Point** ·
**III. Minimal Upstream Drift** · **IV. Spec-Driven Change** · **V. Honest Verification** ·
**VI. Process Boundaries**.

Two additions that are not restatements of upstream:

- **Data Boundaries** — a hard-limits section that bounds Principle II. Collection is scoped to work
  done inside NexWork; staff are told it happens; credentials are never collected; trajectory data
  stays company-internal; content outside the work product is excluded. Principle II removes the
  _per-action consent prompt_, not the disclosure.
- **Deviations from Upstream** — a table stating each reversal, what it replaces, and why, so a
  future sync conflict is resolved from the record instead of re-derived.

Upstream principles II (Modular Architecture), III (UX) and V (Developer Experience) are retained.

## Non-Goals

- Not a rewrite of `AGENTS.md`. Day-to-day conventions stay there; the constitution states the
  principles those conventions serve.
- Not a legal or HR policy. _Data Boundaries_ constrains engineering decisions; whatever staff
  notification the company owes is a separate, non-engineering obligation this spec does not discharge.

## Upstream-drift accounting

| File                              | Δ        | Justification                                                                                                                                                                                           |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.specify/memory/constitution.md` | +109/−74 | Full replacement. Governing document; an overlay would not be read by spec-kit. Upstream's version is recoverable from git history and its retained principles are cited in _Deviations from Upstream_. |

No other file changed. Zero code impact.

## Acceptance Criteria

- [x] Every principle spec 001 and 002 rely on is stated
- [x] Each reversal names what it replaces and why
- [x] Principle II is bounded by enforceable limits, not left open-ended
- [x] Reviewed for internal consistency and unenforceable principles (adversarial review)
- [x] Every boundary is either enforceable by a test or blocks the collection it governs

## Revision 3 — prototype phase

The user's call: NexWork is a prototype, and shipping basic functionality quickly outranks
governance completeness. B-1…B-6 and U-1…U-5 are **suspended, not deleted** — recorded so the
prototype is built in a shape that can honour them, and so leaving the prototype is a checklist
rather than a rediscovery.

The clause ends on a **fact, not a date**: when NexWork is used for real work by anyone outside the
team building it. At that point the boundaries become binding as written and the U-owners must be
assigned before collection continues.

Consequence: revision 2's "collection cannot ship" blocker is lifted for the prototype. Spec 002 and
anything after it are no longer gated on B-5 or U-1…U-5.

## Open Items

- **OI-1** _Data Boundaries_ says staff are told what is collected. Nothing in the product does that
  yet. Either a disclosure surface is specced, or the obligation is explicitly assigned outside
  engineering — otherwise the boundary is decorative.
