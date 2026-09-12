# Obsidian Fountain Plus

A fork of `bgrundmann/obsidian-fountain`. Plugin id is `fountain-plus`, so
command ids are `fountain-plus:…` — the e2e specs depend on that prefix.

## Features

- **Views**: Readonly/edit modes with seamless toggling, PDF export, rehearsal mode with blackout
- **Sidebar**: TOC with navigation, synopsis/notes toggles, snippets with drag-and-drop
- **Index Cards**: Click card → jump to editor at start-of-scene-content; pencil renames scene/section headings inline (section rename also handles depth via leading `#`s and deletion via empty input); hover gutter on each card has stacked `+` (scene) / `#` (section) buttons, with a right-edge variant on the last scene of a section; horizontal `+ section` bars at top-of-doc and tail-of-doc; empty section / empty doc show a dashed `+` card; drag-drop reordering across files; ⌘⇧I toggles cards ↔ editor preserving position. **Section depth in the cards view is 1–3 only**; `script.structure()` treats `####+` headings as scene-internal subsections (`scene.content`), and the section rename refuses depths past 3. See `design/improved_index_card_view.md` and `design/section_editing_in_index_cards.md`.
- **Snippets**: Store in `# Snippets` section, Mod+Shift+X/C to move/copy selection, drag into script/sidebar
- **Editor**: Scene folding (Ctrl+Shift+[ ]), character name completion, ⌘⇧L selects the current scene as text (compose with ⌘X / ⌘C for delete / duplicate)
- **Margin Marks**: `[[@marker]]` syntax renders in margin
- **Links**: `[[>target]]` / `[[>target|display]]` link to other vault files; auto-rewritten on rename. See `design/links.md` for rationale and deferred features.
- **Title Page**: `Edit title page` command creates/edits the `Key: value` block via a modal. Pure read/render/diff helpers in `fountain/title_page.ts`, modal in `title_page_command.ts`. Four parser traps it exists to respect: an empty value kills the *whole* block, the trailing blank line is mandatory, it must be first in the file, and multi-line values need 3-space indents. Unknown keys round-trip untouched.
- **Boneyard**: Content after `# boneyard` hidden when enabled
- **Removal Commands**: Filter by character, scenes, or element types (creates copy by default)
- **Settings**: `settings.ts` — PDF export defaults and the spell-check default, persisted to `data.json`. Only *defaults*; per-view show/hide state stays in the workspace layout. The view takes a `() => FountainSettings` getter rather than importing the plugin, keeping the dependency one-way.
- **Statistics**: `fountain/statistics.ts` (pure) + `statistics_command.ts` (modal). Page count comes from paginating via `pdf/instruction_generator.ts`, which is free of `pdf-lib` — keep it that way or the statistics command drags the PDF library back onto the load path.
- **Final Draft**: `fountain/fdx.ts` — pure string↔string conversion both ways, `fdx_commands.ts` for the vault side. Documented lossiness: export drops sections/synopses/notes; import reads only `Key: value` lines from a Final Draft title page.
- **Touch**: index cards reorder via pointer events (`installTouchDragHandlers`) because WebKit never fires HTML5 drag events from touch. Mice keep the native path. Hover-revealed controls get an `@media (hover: none)` override — without it they are `opacity: 0` and unreachable on a tablet.

## LLM Guidelines

**Discuss design before coding.** Unless explicitly asked to implement, only discuss design and provide small code snippets when clearer than prose.

**DO NOT READ fonts.css.`** It only contains font-face declarations and wastes precious tokens.

**Run e2e tests before declaring work done.** Unit tests (`npm run test`) cover parser/rendering logic but cannot catch view-layer regressions (Obsidian workspace state, sidebar interactions, programmatic-edit propagation across leaves). Always run `npm run test:e2e` and never propose a commit while it has new failures — if a failure pre-exists on `main`, surface it to the user before continuing.

## Implementation

TypeScript with functional style. Jest for unit testing (never mock the parser—use `parse()`).
E2E tests use wdio-obsidian-service (WebdriverIO + real Obsidian instance).

```sh
npm run build    # Build
npm run test     # Unit tests (Jest)
npm run test:e2e # E2E tests (WebdriverIO, launches Obsidian)
npm run lint     # Biome lint (fails on errors, not warnings)
npm run lint:fix # Biome lint with safe autofixes
npm run format   # Biome formatter — NOT yet applied repo-wide, see below
```

`biome.json` configures lint + format. The linter is clean; the
**formatter has never been run across the repo**, so `npm run format`
would touch ~70 files. That's a deliberate one-command decision left to
the maintainer, which is why CI gates on `lint` rather than `biome ci`
(the latter also checks formatting and would fail today).

CI lives in `.github/workflows/ci.yml`: lint, typecheck, unit tests and
build in one job; e2e under `xvfb` in another. The e2e job ends with an
explicit "did any spec actually run?" grep — the wdio runner can exit 0
having run *nothing* (it did exactly that for a while when a chromedriver
download hung), and that reads as a green tick everywhere else.

## Releasing

`./release.sh` is the one-shot release tool. It is driven entirely by
`CHANGELOG.md` — there is no separate version flag.

1. Add a `## [x.y.z] - Title` entry at the top of `CHANGELOG.md`. The
   bullets under it become the GitHub release body verbatim.
2. Commit the code + changelog (and anything else you want shipped).
3. Run `./release.sh`. It parses the topmost changelog header to learn
   the version, prints what it's about to do, and waits for `y` before
   doing anything destructive.

Under the hood it then runs `npm version <ver>` (which fires
`version-bump.mjs` to sync `manifest.json` + `versions.json` and creates
a tagged commit), `git push --follow-tags`, `npm run build`, and
`gh release create <ver> ... main.js styles.css manifest.json` so the
plugin assets are attached to the release.

The script aborts if the release already exists on GitHub. Don't bump
the version manually — let `npm version` do it so the tag, the commit,
and the bumped manifest stay in lockstep.

## Architecture

### Views
- `FountainView` — main view with `ReadonlyViewState` / `EditorViewState`
- `FountainSideBarView` — TOC + snippets sections

### Parser
Peggy.js grammar (`src/fountain/parser.peggy`) → `FountainScript` with:
- `document`, `titlePage`, `script[]`, `allCharacters`
- All elements have `Range` (`{start, end}`) for position tracking
- Margin marks parsed as notes with `noteKind` starting with "@"

**AST design rules** (every-span-has-a-range, line-based-elements-own-
their-lines, optional-markers-as-`Range | null`) are documented as a
comment block at the top of the AST element types in
`src/fountain/types.ts`. Pinned by tests in
`__tests__/{leading_whitespace,trailing_blank_line,
structural_marker_mid_paragraph}.test.ts`. Read the rules before
adding new syntax.

**The parser is total.** Any string is a valid Fountain document —
anything the grammar doesn't recognise falls through to action lines.
The generated Peggy `parse()` doesn't honour that on its own (it throws),
so **call `parseFountain(text)` from `fountain/parse_safe.ts`, never
`parse()` directly**, outside the parser's own tests. It catches, logs,
and falls back to an all-action-lines script over the same document.
Because it cannot fail, consumers have no error branch — and shouldn't
grow one. (There used to be eight `if ("error" in script)` guards; every
one was dead code, since `parse()` returns a `FountainScript` or throws,
never an error object.)

`parser.js` and `parser.d.ts` are autogenerated by `npm run parser`
(runs as a pre-hook on `dev`/`build`/`test`) — don't hand-edit. Configure
the generated types via `peggy_config.mjs`: `returnTypes` is keyed by
grammar **rule name** (e.g. `Script`), not `parse`. The generated `.d.ts`
has no imports, so use inline `import("./script").FountainScript`.

### Snippets
```typescript
interface Snippet { content: FountainElement[]; pageBreak?: PageBreak; }
interface ScriptStructure { sections: StructureSection[]; snippets: Snippet[]; }
```
- Page breaks (`===`) separate snippets, not part of content
- `FountainScript.structure()` parses snippets section
- Re-parse document after modifications rather than in-place edits

### Edit pipeline
All programmatic document mutations go through the path-keyed
`applyEditsToFountainFile(app, path, edits): Promise<void>` in
`src/edit_pipeline.ts`:
- `Edit` and the `compute*Edits` helpers (move/cross-file/scene numbers) live in `fountain/edits.ts` and are pure. Pure structural-navigation helpers (scene-at-offset, start-of-scene-content) live in `fountain/structure_nav.ts`.
- The helper picks source-of-truth based on whether the file is open: any open `FountainView`'s `cachedScript` (so typed-but-unsaved CM state isn't clobbered) or a `vault.read` if no view is open. It reparses once, distributes edits to every view, then awaits `vault.modify`.
- `EditorViewState.receiveEdits` dispatches them as a single CM transaction so cursor/undo survive; `ReadonlyViewState.receiveEdits` re-renders.
- `FountainView.applyEditsToFile` is a thin wrapper that delegates to the helper using the view's path — use it when you have a view in hand.
- The plugin also exposes `FountainPlugin.applyEditsToFountainFile(path, edits)` for callers that don't have a `FountainView` (e.g. e2e tests and the future link-rename handler).
- `FountainView.setViewData` handles only Obsidian-initiated external reloads (no edits available; calls `receiveScript` for a full-doc replace).
- User-typed edits flow through CM's update listener → `onUserEdit` → sibling views via `receiveScript`.

### PDF Generation
Uses `pdf-lib`. Two-phase: generate draw instructions → render to PDF.
Left margin fixed at 1.5" for binding; other margins computed to maintain consistent characters/line across paper sizes.

## Source Layout

Note: the `fountain/` directory at repo root is the Claude Code skill
(`fountain/SKILL.md`), not source. The Fountain parser/core lives in
`src/fountain/`.

In `src/`:

- **`main.ts`** — plugin entry, lifecycle, command registration.
- **`commands.ts`** — command implementations + `ifFountainFile` / `ifFountainView` checkCallback helpers.
- **`edit_pipeline.ts`** — path-keyed `applyEditsToFountainFile` (the canonical entry point for programmatic mutations) and `findFountainViewsForPath`.
- **`links_index.ts`** — `LinkIndex` for `[[>...]]` cross-file links: `targetPath → Set<sourceFile>` lookup, vault listeners, and rename rewriting through `applyEditsToFountainFile`.
- **`removal_commands.ts`** — removal-command modals (UI only). The pure text-removal helper lives in `fountain/removal.ts`.
- **`title_page_command.ts`** — title page modal (UI only). The pure helpers live in `fountain/title_page.ts`.
- **`settings.ts`** — `FountainSettings`, defaults, and the settings tab.
- **`statistics_command.ts`** — statistics modal + page counting. Pure counting lives in `fountain/statistics.ts`.
- **`fdx_commands.ts`** — Final Draft import/export commands. Pure conversion lives in `fountain/fdx.ts`.
- **`fuzzy_select_string.ts`** — fuzzy search modal.
- **`fountain/`** — parser and AST core. Entry: `index.ts` (barrel). `parse_safe.ts` holds `parseFountain`, the total-parse boundary every consumer should use. `title_page.ts` holds the pure title page read/render/diff helpers. Grammar in `parser.peggy` (autogenerates `parser.js`/`parser.d.ts` via `npm run parser`; don't hand-edit). `edits.ts` defines the `Edit` primitive and the pure `compute*Edits` helpers used by the edit pipeline.
- **`codemirror/`** — CodeMirror integration: syntax highlighting, parsed-script `StateField`, scene folding, character-name completion.
- **`views/`** — the main Obsidian view for `.fountain` files. Entry: `fountain_view.ts` (delegates programmatic edits to `edit_pipeline`). `view_state.ts` defines the shared `ViewState` interface implemented by `readonly_view_state.ts` and `editor_view_state.ts`.
- **`sidebar/`** — the separate TOC + snippets sidebar (`FountainSideBarView`). Different Obsidian view type from `FountainView`; consumes shared rendering helpers from `views/`.
- **`pdf/`** — PDF export. Entry: `generator.ts` (facade). Two-phase pipeline: `instruction_generator.ts` produces draw instructions, `renderer.ts` renders them with `pdf-lib`.

Unit tests live in `__tests__/`. E2E tests live in `test/e2e/` (specs in `specs/`, vaults in `vaults/`).

Styling is in `core_styles.css`. As part of the build process `esbuild.config.mjs` concatenates 
`fonts.css` and `core_styles.css` into `styles.css`.

`fonts.css` and `styles.css` are very long and should not be read!
