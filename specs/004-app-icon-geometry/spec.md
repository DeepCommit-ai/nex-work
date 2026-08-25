# Feature Specification: App Icon Geometry

**Feature Branch**: `nex-work`
**Created**: 2026-08-25
**Status**: Implemented, revision 5 — in-app mark keeps its original footprint
**Input**: "现在的 logo 在 mac 的 doc 里面的时候和其他的 logo 不一样，正常的 app logo 应该是圆角而且有 margin。你要写测试确保说这些是在不同 mac 系统下都能正常显示"

## Why

In the macOS Dock the NexWork icon rendered as an oversized opaque square beside correctly-built
neighbours. **The Dock does not mask app icons** — an icon must ship its own rounded shape _and_ its
own margin, or it is drawn exactly as authored.

This is a regression introduced by spec 001, not a design problem. Measuring the assets against the
upstream originals they replaced:

|                                           | corner alpha | body fill                      | transparent px |
| ----------------------------------------- | ------------ | ------------------------------ | -------------- |
| upstream `app_dev.png`                    | 0            | **820×820 @(102,102) = 80.1%** | 37.2%          |
| upstream `app.png`, `icon.png`, PWA icons | 0            | 100%                           | 2.0–3.8%       |
| **ours, after spec 001**                  | **255**      | 100%                           | **0.0%**       |

Upstream's dev icon sat at 820×820 @ (102,102) — the same geometry as the dark body inside the
NexWork source artwork. The artwork was drawn to the macOS grid; the generation step flattened its
transparency, filling the margin and the rounded corners with opaque background. **All eight icon
assets lost their alpha channel.**

## Platform conventions

| Platform               | Convention                                                                                             | Consequence of getting it wrong                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| macOS                  | Apple Big Sur grid: body 824/1024 (100px margin), corner radius 185.4/824 = 22.5%, transparent outside | Icon renders larger than its neighbours, square if opaque |
| Windows                | Full-bleed; no margin                                                                                  | A margin makes the taskbar icon look small                |
| Linux                  | Full-bleed; DEs generally do not mask                                                                  | Same                                                      |
| PWA / apple-touch-icon | Full-bleed; `purpose: any`, so the platform may mask                                                   | Same                                                      |

## Functional Requirements

- **FR-1** Every shipped icon asset has a real alpha channel with fully transparent corners.
- **FR-2** macOS assets (`app.icns`, and `app_dev.png`, which `src/index.ts` uses for the unpackaged
  app on macOS and Linux) place the body on the Apple grid.
- **FR-3** Non-macOS assets are full-bleed with rounded, transparent corners and no margin.
- **FR-4** `app.icns` carries every member macOS selects between, at @1x and @2x. macOS picks per
  context — Dock, Finder, Cmd-Tab, Get Info — and per display scale; a missing member is upscaled
  from a smaller one and looks soft.
- **FR-5** `app.ico` carries 16/24/32/48/64/128/256 px.
- **FR-6** Icons are generated from a committed source artwork by a committed script, so they can be
  regenerated rather than hand-edited.
- **FR-7** Tests assert the geometry that makes an icon render correctly, and fail on the regression
  above.
- **FR-8** The macOS menu bar gets a **template** image — alpha-only artwork macOS recolours for the
  light or dark bar — carrying the glyph alone, at @1x and @2x.
- **FR-9** Every icon the packaged app loads at runtime is listed in `extraResources`.

## What "works on different macOS versions" is testable as

Rendering cannot be asserted from a unit test, and no test here claims to. What _is_ asserted is the
structural contract every macOS version relies on: the member set, per-member decoded size,
transparent corners, and body fraction. macOS version differences show up as _which member is
selected_, so covering every documented member is the meaningful proxy — a claim the spec makes
explicitly rather than implying a rendering test exists.

The tests parse the committed `.icns` and `.ico` binaries directly — no `iconutil` (macOS-only), no
network — so they run identically on Linux CI.

## Key Decisions

- **D-1 — The artwork is scaled whole; it is never decomposed.** _(Corrected in revision 2 — see
  Review Corrections.)_ The cream field is part of the icon, not a background. The generator scales
  the entire source into the body and masks the body to a rounded square with 4×4 supersampled
  corners. Nothing is cut out, nothing is redrawn.
  Consequence, stated plainly: on the macOS asset the dark panel lands at **64.3%** of the canvas
  (80.5% body × ~80% panel-within-artwork). The _icon_ is correctly sized at the Apple 824/1024 body;
  the dark panel sits inside it with the designer's own padding.
- **D-2 — The corner is a superellipse approximation** (exponent 3) of Apple's continuous corner,
  which is a proprietary curve. Deviation peaks around 1px at typical Dock sizes. Stated as an
  approximation rather than as Apple's exact shape.
- **D-3 — Radius normalised to Apple's 22.5%.** The artwork used 20.7% and upstream's icons used
  ~15.5%. Apple's value is what makes the icon sit correctly among Dock neighbours.
- **D-4 — The generator is not run by the test suite.** It needs `iconutil` (macOS-only) and
  `bunx png2icons` (network). `--check` mode exists for manual/CI verification; the unit tests parse
  the committed binaries instead so CI stays hermetic.

## Acceptance Criteria

- [x] `app.icns` carries ic04/ic05/ic07/ic08/ic09/ic10/ic11/ic12/ic13/ic14
- [x] Every PNG member decodes at its documented size with corner alpha 0 and body fraction 80.5% ±2%
- [x] `app_dev.png` is 824×824 @ (100,100) on a 1024 canvas
- [x] Six full-bleed assets are edge-to-edge with transparent corners
- [x] `app.ico` carries 9 entries, 16→256 px
- [x] **The tests fail on the regression**: restoring the opaque artwork over `resources/app.png`
      turns exactly one assertion red ("still has transparent corners"); restoring the fixed asset
      returns to green
- [x] `tsc` 0 · `lint` 0 errors · `format:check` clean · **full suite 5008 passed / 5 skipped**

## Upstream-drift accounting

| File            | Δ        | Justification     |
| --------------- | -------- | ----------------- |
| 9 icon binaries | replaced | The change itself |

New ours-owned files (no drift): `scripts/generate-brand-icons.mjs`,
`resources/brand/nexwork-source-1024.png`, `tests/unit/branding/appIcons.test.ts` (41 cases).
**No upstream text file was modified.**

## Revision 4 — the in-app mark is the icon, not a redraw

The sidebar brand chip was still an inline SVG of the glyph in `currentColor`, sitting on a painted
square. That is not the brand mark — it is one piece of it with the cream field discarded, which is
the same mistake revision 2 corrected in the icon files. It was also a second source of truth:
regenerating the icons would not have touched it.

`BrandMark` now renders `assets/logos/brand/app.png` — the generated icon itself — so the in-app mark
and the app icon cannot diverge. `brand-override.css` carries the other half: it clears the chip's `bg-black`, which would otherwise
show through the icon's transparent corners as dark slivers.

**Revision 5 correction:** revision 4 also forced the mark to fill the chip and reset upstream's
`scale-140`. That made the brand mark visibly larger than it had ever been. Sizing now belongs
entirely to upstream's `w-5.5 h-5.5 … scale-140` classes, so adding the cream field changed the
mark's appearance without changing its footprint. A test asserts the stylesheet never sets `width`,
`height` or `transform` on the mark.

Upstream diff: unchanged — `Layout.tsx` still calls `<BrandMark/>` with the same props.

## Revision 3 — macOS menu-bar tray

`tray.ts` carried the comment _"macOS uses Template image to adapt to dark/light menu bar"_ while
never calling `setTemplateImage(true)` and loading the full-colour `resources/app.png`. The comment
described behaviour the code did not have. Upstream got away with it; our cream field does not —
at 16px the menu bar showed a cream tile with the mark too small to read.

- `resources/trayTemplate.png` (16) and `trayTemplate@2x.png` (32) are alpha-only, glyph-only, and
  generated from the **same source artwork** — the glyph is recovered by flood fill plus luminance,
  so there is no second source of truth for the mark.
- `createBrandTrayImage()` in the branding layer returns the template on macOS and **null**
  everywhere else, and also null when the asset is missing, so the caller keeps its existing icon
  rather than showing a blank menu-bar square. Upstream diff: `tray.ts` +3 lines.
- **`extraResources` is an explicit allow-list**, not a directory copy — it names `resources/app.png`
  file by file. An unlisted asset is missing in _packaged builds only_, which is where it is hardest
  to notice. Both templates are now listed, and a test asserts they stay listed.

Verified: alpha-only (0 coloured pixels), glyph fills 78–81% of the square, and swapping in the full
app icon turns exactly the two intended assertions red.

## Review Corrections

Revision 2, after the user corrected the artwork treatment.

Revision 1 read the cream field as a background to be removed and rebuilt the icon from an extracted
glyph. That was wrong: the cream is part of the design. It also cost more than it bought — a flood
fill, a luminance matte and a re-render, all to reproduce something the source already contained.

Revision 2 scales the source whole and masks it. The generator is shorter, the output is faithful to
the artwork, and two tests now guard the mistake: one asserts the cream field is still present and
opaque inside the body, the other asserts the dark panel stays at the proportion the designer drew
rather than being stretched to fill the body.

The geometry contract was unaffected — all 41 original assertions passed unchanged across the
rewrite, because what changed was the body's _content_, not its shape or placement.

## Open Items

- **OI-1** Not visually confirmed in a live Dock — no screen-recording permission on this machine.
  Geometry is asserted numerically; the rendered result needs a human look.
- **OI-2** `resources/icon.png` has no referrer in this repo (`git grep` finds none). Regenerated for
  consistency; a follow-up could delete it.
- **OI-3** PWA icons are `purpose: any`. If Android maskable icons are wanted later, they need a
  separate asset with a 20% safe zone — a full-bleed icon gets cropped by the platform mask.
