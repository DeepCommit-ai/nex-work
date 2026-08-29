---
name: debugging
description: |
  Layered-falsification debugging workflow for multi-layer failures.
  Use when: (1) A fix "worked" but the same symptom returned, (2) The failure
  crosses process/stack boundaries (renderer ↔ main ↔ backend ↔ spawned CLI ↔
  external tool), (3) A user reports "still broken" after a verified fix,
  (4) The error message names a state you can independently measure.
---

# Debugging Skill

Layered falsification: treat every recurring symptom as a **stack of independent
defects wearing the same error message**. The method that turned one symptom
(「浏览器未连接」) into six distinct root causes across six layers is recorded in
`specs/007-runtime-path-hardening/spec.md`; this skill codifies it.

**Announce at start:** "I'm using the debugging skill — layer by layer, evidence first."

## Trigger Conditions

- A previously verified fix did not make the user's symptom go away
- The same error text can plausibly be produced by more than one layer
- The failure involves a chain: UI → IPC → backend → spawned process → protocol
- You are about to write "should work now" without fresh evidence

## The Rules

### 1. A symptom is not a cause

Never reuse the previous diagnosis for a recurring symptom. After each fix,
**re-derive the failing layer from scratch** — the next layer's failure usually
reads identically. Ask: which layers could produce this exact message? List
them before touching code.

### 2. Hard evidence per layer, before any fix

Every layer gets its own ground-truth probe. Guesses do not go into commits.

| Layer            | Probe                                                            |
| ---------------- | ---------------------------------------------------------------- |
| Process tree     | `ps` / `pgrep -P` — who spawned what, with which binary          |
| Environment      | `ps eww <pid>` — the env a process actually inherited            |
| Ports/state APIs | `curl` the service's own introspection endpoints                 |
| Protocol traffic | A MITM proxy that rewrites discovery and logs both directions    |
| Client behavior  | A minimal fresh client speaking the real protocol (stdio/WS)     |
| Stored state     | The backend's own HTTP API or DB, never the UI's rendering of it |

Keep probes as runnable scripts in the session scratchpad — they are the
regression harness for the _diagnosis_, not just the fix.

### 3. Distinguish the three state pairs

Before concluding anything, separate:

- **Old connection vs fresh connection** — clients cache failure (e.g. a
  rejected promise held forever); a stale client failing proves nothing about
  the system's current state. Always probe with a _fresh_ client too.
- **Race vs permanent** — retry the identical call on the same connection after
  a delay. Different result ⇒ race; same result ⇒ state.
- **Your path vs the user's path** — a direct probe succeeding does **not**
  verify the product path. Reproduce with the user's exact entry point (same
  message shapes, same spawn chain, same defaults). This is the most expensive
  lesson in spec 007: the probe worked for turns while the product path had
  three more defects.

### 4. Fix at the layer that owns the invariant

Prefer the fix that makes the _class_ of failure impossible over the one that
patches this instance (e.g. "prepend the known-good runtime dir to child PATH"
over "fix this machine's node"). If the ideal owner is another repo, ship the
complete client-side fix and file the note — never a half fix awaiting someone
else.

### 5. Every fix carries a negative constraint test

State what must **never** trigger the new behavior, and pin it: "navigation
re-reports must not disconnect clients", "same-target re-attach must not
reset". The negative space is where the next regression hides.

### 6. Error messages are part of the fix

If an agent (or user) reads the error, the text must state the _current_
correct next action. Stale guidance ("open the panel") actively caused retries
to be abandoned after auto-open existed. When behavior changes, re-read every
error message that referenced the old behavior.

### 7. Close the loop in writing

- Append findings to the owning spec (`specs/`) with measured evidence, per
  the spec-driven workflow — including honest residuals and what was **not**
  verified (e.g. "win32 branches unit-tested, never run on real Windows").
- If the defect class is upstream-relevant, mark it as a sync-back candidate.

## Escalation

For a contradiction you cannot resolve in two probes (e.g. "server says
attached, client says not attached"), split the work: a subagent reads both
codebases' state machines line-by-line for the exact mechanism while you keep
gathering live evidence — then require the code reading and the wire capture
to agree before implementing.
