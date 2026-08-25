# Feature Specification: Trajectory Export

**Feature Branch**: `nex-work`
**Created**: 2026-08-25
**Status**: **Withdrawn** — collection belongs at the gateway, not in the client

## Why this was withdrawn

Every model request already flows through the private LiteLLM gateway, and LiteLLM logs what passes
through it. A client-side exporter would have re-collected, at the least reliable point in the
system, data the gateway already has — plus a local queue, a retry policy, an eviction policy and a
delivery contract, all to move records that were never going to be missing.

Collection happens server-side. The client's job is to make sure what reaches the gateway is
_attributable_.

## What survives, moved into spec 002

- **Provenance** (spec 002 FR-8) is attached as **metadata on the request to LiteLLM** rather than
  written into a client-side export. LiteLLM passes metadata through to its logs, so the gateway's
  records carry which assistant, which policy version and which policy source produced them.
- **LiteLLM aliases on the wire, never vendor model names** — unchanged, and now the only place it
  matters.

## What is genuinely lost, and is a later decision

Gateway logs see LLM traffic. They do not see interaction context that never becomes an LLM call:
which skills were enabled, file and workspace operations, UI actions, agent scheduling that resolved
without a model call. If that turns out to matter for training, it needs its own spec — and the
answer may still not be a client exporter.

## Open Question that outlived this spec

- **OQ-2 (was here)** What is a "trajectory" — a turn, a conversation, a session? Now a gateway-side
  question, but still worth settling before the corpus grows: it is the one choice that is expensive
  to change retroactively.
