> **Historical.** The index card view was removed in October 2026; scenes are now reordered from the outline sidebar. Kept for the reasoning behind it.

# Section Editing in Index Cards — Rationale

This is the why-doc for the section affordances in the index card view
(insertion gutters, `+ section` bars, depth-via-rename). Implementation
lives in `src/views/index_cards_view.ts` and the user-facing reference
in `README.md`. Companion: `design/improved_index_card_view.md`.

## Section depth: 1–3 only

The cards view models sections of depth 1–3. `script.structure()`
treats `####+` headings as scene-internal subsections (they end up
in `scene.content`, not as their own structural section), and the
section rename refuses to commit a depth past 3 — empty rename and
malformed-input rules apply equally to "too deep."

This is a long-standing convention that wasn't previously written
down. The split is: depths 1–3 are the script's outline (act, part,
sequence) and belong on the cards; deeper hashes are author notes
inside a scene. The h-tag mapping (`h1`/`h2`/`h3`) is clamped so
nothing slips through and renders as raw text.

## Why depth and deletion live in the rename input

The rename input shows the full `## Title` form. Editing the `#`s
changes depth (within 1–3); clearing the input deletes the section
heading line and lets its children flow up to the parent on
reparse.

This deliberately exposes a sliver of Fountain syntax (`#`s) in the
cards view. Acceptable because the view *already* shows `#`/`##`/
`###` in section headings, and the trade buys a single uniform
gesture covering insert-then-promote and existing-depth-change with
no extra UI on the heading row.

**No cascade.** Children retain their own depth — a `#` change in
source doesn't auto-renumber `##` children, and we mirror that.
"Push the whole subtree down a level" is a separate command (an
indent/outdent-subtree action), out of scope for rename.

The deletion-by-empty-input gesture is novel; the alternative
(reject empty input, add a separate "delete section" affordance)
was rejected because the heading-row affordance budget is tight and
the gesture is intuitive once seen.

## Why `+ section` bars only at the edges

Bars appear above the first section (when the doc starts with one,
or is empty) and at the bottom of the doc. Bars between every pair
of sections were prototyped and judged redundant — that position is
already reachable via the vertical `#` button on the previous
section's last scene.

On an empty doc both bars *and* the dashed `+` card show, so
section-first and scene-first starts have an obvious aim point
without the user having to choose between them.

## Why scene-shaped operations stay one click

The hover gutter on each scene card carries stacked `+` (scene) and
`#` (section) buttons. `#` always inserts a depth-1 section; promote
later via the rename input. The cards view does not surface a depth
picker on insert — same reason as above (affordance budget).

## Postponed: drag-and-drop of sections

Section drag-reorder is **deliberately postponed**. Concrete reasons:

- The drop-target story is awkward. Same-depth-only is too
  restrictive for the real reorders authors want; full re-parenting
  needs visual vocabulary the current insertion bar doesn't provide.
- Most reorders in practice are within-act scene reorders, already
  handled by scene drag.
- Cut-and-paste in the editor (⌘⇧L → ⌘X / ⌘C / ⌘V) handles the
  rare cross-cut section-level move and works across files.

When this comes back, the design questions to revisit:

- Is same-depth-only enough, or does v1 need re-parenting?
- Visual vocabulary for re-parent drops vs. position-only drops.
- The cascade question for keyboard-driven moves (⌃⌘← / ⌃⌘→ in
  Scrivener's binder is the precedent — children move with the
  parent).

## Known limitations

Accepted trade-offs, not bugs to fix.

- **Touch / mobile.** All gutters are hover-revealed. The cards view
  already relied on hover for pencil and grip, so this redesign
  doesn't make mobile worse, but it doesn't fix it either. A
  separate persistent affordance for touch is its own project.
- **No way to insert a section between two empty sections.** If the
  doc is `[Section A (empty), Section B]`, there are no scenes to
  anchor a vertical gutter and the only horizontal bar is above
  the first section. The user has to add a scene first or use the
  editor. Rare in practice.
