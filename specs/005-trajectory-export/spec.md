# Feature Specification: Trajectory Export

**Feature Branch**: `nex-work`
**Created**: 2026-08-25
**Status**: Draft — awaiting approval
**Input**: "后端还给不出（端点形状），目前先不实现鉴权，就是一个单向的数据收集和分析，然后之后可以考虑接入 MCP 端点来鉴权"

## Why

This is the product's reason to exist. The company has no consolidated digital record: knowledge sits
in individual heads, chats and local files, so there is no corpus to index and no RAG-style system is
possible. NexWork inverts that dependency — staff do their normal work through the tool, and the
corpus is produced as a by-product.

Everything else in this repo is the delivery vehicle. This spec is the payload.

## Shape

**One-way and unauthenticated.** The desktop pushes; the backend collects and analyses; nothing comes
back. Auth arrives later, likely over an MCP endpoint.

That single decision has a consequence worth stating up front: **there is no server→client channel**,
so nothing in the product can be server-driven until one exists. Spec 002's static capability
provider is a consequence of this, not a shortcut.

## User Scenarios

1. A user works normally. Trajectories are exported in the background with no interaction and no
   visible latency.
2. The backend is unreachable. Work is unaffected; records queue locally and go out later.
3. The queue cannot drain for a long time. It is bounded — it does not grow until the disk is full.
4. The user quits mid-session. Records already produced are not lost.

## Functional Requirements

- **FR-1** Export never blocks or slows the user. Failure to export is never surfaced as a work error.
- **FR-2** Records are durably queued locally before any send attempt, and survive restart.
- **FR-3** The queue is bounded with a stated eviction policy. Unbounded growth is a defect.
- **FR-4** Delivery is at-least-once with a stable record id, so the backend can de-duplicate. The
  client does not attempt exactly-once.
- **FR-5** Every record carries provenance: app version, policy version and source (spec 002 FR-8),
  assistant id, and the **LiteLLM alias** — never a vendor model name, which is a gateway-side
  routing detail that can change.
- **FR-6** The wire format is versioned from the first record. A corpus whose earliest records cannot
  be identified by schema version is expensive to use later.
- **FR-7** Transport is behind one interface with the endpoint in configuration, so the eventual
  authenticated MCP endpoint replaces the implementation and nothing else.

## Non-Goals

- Authentication, identity, per-user attribution — later, with MCP.
- Any server→client traffic. One-way is the whole design.
- Redaction, retention, access control, deletion: the constitution's data boundaries are **suspended
  for the prototype** (spec 003 rev 3). Recorded there; not implemented here.

## Open Questions

- **OQ-1** Endpoint shape — URL, method, payload envelope, batch vs. single. Blocked on the backend.
  Everything above is designed so this is a late, cheap decision.
- **OQ-2** What is a "trajectory"? A turn, a conversation, a session? This determines record size and
  volume and should be settled before the first record is written, because it is the one choice that
  is expensive to change retroactively.
- **OQ-3** Queue bound and eviction: drop oldest or drop newest? Different answers suit different
  analyses.

## Dependencies

- Spec 002 FR-8 (provenance) — records must carry it from the first one.
- LiteLLM alias vocabulary (spec 002 OQ-2) — FR-5 needs stable names.
