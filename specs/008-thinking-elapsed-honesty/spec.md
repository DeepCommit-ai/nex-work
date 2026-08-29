# Spec 008 — Thinking elapsed-time honesty on mid-turn re-entry

**Status**: Implemented (frontend); one backend candidate filed
**Owner lane**: `acp` conversations (the only lane that renders live thinking bubbles;
`useAionrsMessage` has no thinking handling)

## Why

User report (2026-08-29): 「每次点开一个对话都显示重新思考,思考时间从 0 开始」— switching
back into a conversation showed "思考中 · 0s" counting up from zero, reading as if the agent
had started thinking all over again.

### What is actually happening (measured)

The backend re-runs nothing. Reconstructed from dev.log + renderer runtime-view logs:

- Two turns ran concurrently (05:27:43 `turn_8c5c80dd`, 05:27:52 `turn_2c688b35`, the latter
  154 s long); the user toggled between the two conversations every few seconds
  (`active-lease`/`runtime/ensure` pairs at 05:29:07 / :15 / :24 / :26 / 05:30:19 / :21…).
  Each re-entry hydrated `isProcessing: true` (`runtime_hydrated` renderer log) — the turn was
  still running; no message was re-sent, no turn re-claimed.
- History pagination loads `content_mode=compact`, and **compact responses contain zero
  `thinking` rows** (measured: same conversation returns 17 thinking rows in full mode, 0 in
  compact). An in-flight thinking segment therefore has no anchor in the reloaded list.
- The bubble is rebuilt purely from **post-re-entry stream chunks**; the merged message's
  `created_at` is the first such chunk's receive time (`chatLib.ts` transform:
  `message.created_at ?? Date.now()`), and `MessageThinking` derives its live counter from
  that — so the counter restarts at 0 on every re-entry.
- Worse, the synthetic "done" duration was client-computed from the same false origin
  (`completeActiveThinking`: `endTime - startedAt` with `startedAt` = first chunk seen by
  _this mount_), so even the final 「思考完成 · Ns」 understated the real segment.
- Ruled out along the way: no server-side replay on open (cold `runtime/ensure` with
  `recovered: true` broadcasts a single `acp_config_option` frame, nothing else, 40 s watch);
  all persisted thinking rows across all 15 conversations are `status: done` with sane
  `duration_ms`; `runtime.is_processing` is `false` for every finished conversation.

Real Chrome-of-this-bug: the elapsed number's _origin_ is only known to the mount that
witnessed the segment start. A mount that joined midway has no honest number to show.

## Functional Requirements

- **FR-1 (witnessed-origin rule)** A thinking bubble whose segment start this mount did not
  witness is stamped `startUnwitnessed` (new optional field on `IMessageThinking.content`),
  and the renderer shows 「思考中...」 with **no elapsed counter** for it. Witnessing state:
  assumed _unwitnessed_ from conversation switch until hydration settles; confirmed
  unwitnessed while `runtime.is_processing` hydrates true; cleared by the first witnessed
  segment boundary (any non-thinking stream message, or a thinking `done` frame), by a local
  send (a turn is witnessed from birth), by idle/absent hydration, and by turn end.
- **FR-2 (no fabricated durations)** A client-computed completion duration is attached only
  when the segment start was witnessed. A backend-provided duration (`duration`/`duration_ms`
  on a done frame) is always trusted, unwitnessed or not. A completed bubble without a
  trustworthy duration renders 「思考完成」 with no number — 宁缺毋假.
- **FR-3 (pinned negatives)** Same-mount streaming is untouched: bubbles created after a
  witnessed boundary keep the live counter and the computed done-duration
  (`useAcpMessage.dom.test.ts`); the stamp survives chunk appends and the done merge
  (`messageMerging.dom.test.tsx`); remount of a witnessed bubble still resumes its counter
  from `created_at` (pre-existing test kept green).

## Acceptance

- [x] Focused tests: 3 rendering cases (`messageThinking.dom.test.tsx`), 3 lane cases
      (`useAcpMessage.dom.test.ts` — stamp + boundary re-trust + backend-duration trust +
      idle no-stamp), 1 merge-survival case (`messageMerging.dom.test.tsx`); 59 tests green
      across the five related files
- [x] Two pre-existing tests updated to the new contract (they pushed frames before hydration
      settled, which now correctly reads as an unwitnessed window): each gained an explicit
      hydration-settled preamble, assertions unchanged
- [x] Gates: oxlint 0 errors, oxfmt, `tsc --noEmit`, i18n checks (no new user-facing strings —
      existing `conversation.thinking.*` keys only)

## Boundaries & residuals

- The bubble's _text_ also only contains post-re-entry chunks; this spec fixes the lying
  numbers, not the truncated transcript. The full transcript exists only backend-side.
- After an app reload, completed thinking blocks disappear entirely (compact history omits
  them). Backend candidate (aioncore / cynapse): include `thinking` rows in compact history
  (tiny rows — status, duration, subject) so completed thoughts survive reload and an
  in-flight bubble can anchor its true origin; with that, `startUnwitnessed` would only ever
  apply for the sub-second hydration window.
- ThoughtDisplay (send-box bar) was already honest across re-entry via
  `conversationTurnClock` (module-level turn origins) and is untouched.
- `aionrs` lane renders no thinking bubbles; nothing to do there today. If it grows them,
  the witnessing rules above apply.
