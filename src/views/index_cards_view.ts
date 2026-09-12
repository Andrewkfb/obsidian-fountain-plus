import { setIcon } from "obsidian";
import type {
  FountainScript,
  Range,
  Section,
  StructureScene,
  StructureSection,
  Synopsis,
} from "../fountain";
import { dataRange, extractNotes } from "../fountain";
import { endOfRange, getScenePreview } from "./render_tools";
import { styledTextToHtml } from "./styled_text";
import type { ReadonlyViewCallbacks } from "./view_state";

type DragData = {
  path: string;
  range: Range;
};

function getDragData(evt: DragEvent): DragData | null {
  try {
    const json = evt.dataTransfer?.getData("application/json");
    if (!json) return null;
    const d: DragData = JSON.parse(json);
    return d;
  } catch (error) {
    return null;
  }
}

function clearDropIndicators(): void {
  for (const el of document.querySelectorAll(
    ".screenplay-index-card.drop-left, .screenplay-index-card.drop-right",
  )) {
    el.classList.remove("drop-left");
    el.classList.remove("drop-right");
  }
}

/** FLIP animation helpers: capture the bounding rects of every index card
 * before a move, then after the re-render slide each card from its old
 * position to its new one so the user sees the rearrangement. */
function cardKey(card: Element): string {
  // textContent of the card is heading + synopsis + todos — usually unique
  // enough across a single document. Truncated so very long synopses don't
  // dominate the map.
  return (card.textContent ?? "").slice(0, 200);
}

function captureCardRects(): Map<string, DOMRect[]> {
  const rects = new Map<string, DOMRect[]>();
  const cards = document.querySelectorAll<HTMLElement>(
    ".screenplay-index-card[data-range]",
  );
  for (const card of cards) {
    const key = cardKey(card);
    if (!key) continue;
    const arr = rects.get(key);
    const r = card.getBoundingClientRect();
    if (arr) arr.push(r);
    else rects.set(key, [r]);
  }
  return rects;
}

function applyFlipAnimations(oldRects: Map<string, DOMRect[]>): void {
  if (oldRects.size === 0) return;
  const seen = new Map<string, number>();
  const cards = document.querySelectorAll<HTMLElement>(
    ".screenplay-index-card[data-range]",
  );
  for (const card of cards) {
    const key = cardKey(card);
    if (!key) continue;
    const arr = oldRects.get(key);
    if (!arr) continue;
    const idx = seen.get(key) ?? 0;
    seen.set(key, idx + 1);
    const oldRect = arr[idx];
    if (!oldRect) continue;
    const newRect = card.getBoundingClientRect();
    const dx = oldRect.left - newRect.left;
    const dy = oldRect.top - newRect.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    card.style.transform = `translate(${dx}px, ${dy}px)`;
    void card.offsetHeight; // force reflow so the transition picks up
    card.classList.add("flip-animate");
    card.style.transform = "";
    card.addEventListener(
      "transitionend",
      () => {
        card.classList.remove("flip-animate");
      },
      { once: true },
    );
  }
}

/** Apply a card move and animate it. Shared by the mouse (HTML5
 *  drag-and-drop) and touch (pointer event) paths so both produce
 *  exactly the same edit. Returns false when the move is a no-op. */
function performCardMove(
  src: DragData,
  dstPath: string,
  dstRange: Range,
  before: boolean,
  callbacks: ReadonlyViewCallbacks,
): boolean {
  // Same-file no-op: dropping a card on itself.
  if (src.path === dstPath && src.range.start === dstRange.start) return false;
  const oldRects = captureCardRects();
  callbacks.moveSceneAcross({
    srcPath: src.path,
    srcRange: src.range,
    dstPath: dstPath,
    dstPos: before ? dstRange.start : dstRange.end,
  });
  callbacks.requestSave();
  callbacks.reRender();
  applyFlipAnimations(oldRects);
  return true;
}

function dropHandler(
  dropZone: HTMLElement,
  path: string,
  dropZoneRange: Range,
  callbacks: ReadonlyViewCallbacks,
  evt: DragEvent,
) {
  const before = dropZone.classList.contains("drop-left");
  const after = dropZone.classList.contains("drop-right");
  dropZone.classList.remove("drop-left");
  dropZone.classList.remove("drop-right");
  if (!before && !after) return;
  const dragData = getDragData(evt);
  if (!dragData) return;
  evt.preventDefault();
  performCardMove(dragData, path, dropZoneRange, before, callbacks);
}

/** Mark the drop side on `dropZone` from a pointer x position, using the
 *  same half-way rule as `dragoverHandler`. */
function markDropSide(dropZone: HTMLElement, clientX: number): void {
  const rect = dropZone.getBoundingClientRect();
  const clampedX = Math.min(Math.max(clientX, rect.left), rect.right);
  const percentage = ((clampedX - rect.left) / rect.width) * 100;
  dropZone.classList.toggle("drop-right", percentage >= 50);
  dropZone.classList.toggle("drop-left", percentage < 50);
}

/** Read a card's range back out of the DOM. Touch drags resolve their
 *  drop target by hit-testing rather than from a closure, so the target's
 *  identity has to be recoverable from the element itself. */
function cardRange(card: HTMLElement): Range | null {
  const raw = card.getAttribute("data-range");
  if (raw === null) return null;
  const parts = raw.split(",");
  if (parts.length !== 2) return null;
  const start = Number.parseInt(parts[0], 10);
  const end = Number.parseInt(parts[1], 10);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { start, end };
}

/**
 * Pointer-based drag fallback, for touch.
 *
 * Reordering uses the HTML5 drag-and-drop API, which WebKit does not
 * deliver from touch input — `dragstart` never fires — so on an iPad the
 * cards view silently loses drag-reordering altogether. This runs the
 * same gesture on pointer events and ends in the same `performCardMove`,
 * reusing the drop-left/drop-right indicator classes so the two paths
 * look and behave identically.
 *
 * Mice keep the native path: it also handles drags that leave the window,
 * which pointer capture cannot.
 */
function installTouchDragHandlers(
  handle: HTMLElement,
  card: HTMLElement,
  path: string,
  range: Range,
  callbacks: ReadonlyViewCallbacks,
): void {
  let dragging = false;

  const stop = () => {
    dragging = false;
    card.classList.remove("dragging");
    card
      .closest(".screenplay-index-cards")
      ?.classList.remove("dragging-active");
  };

  handle.addEventListener("pointerdown", (evt: PointerEvent) => {
    if (evt.pointerType === "mouse") return;
    // Claim the gesture: without capture the pointer stream stops as soon
    // as the finger leaves the grip.
    evt.preventDefault();
    evt.stopPropagation();
    dragging = true;
    try {
      handle.setPointerCapture(evt.pointerId);
    } catch {
      // Throws when the pointer id isn't active. The drag still works
      // without capture as long as the finger stays over the cards, so
      // this is a degradation rather than a failure.
    }
    card.classList.add("dragging");
    card.closest(".screenplay-index-cards")?.classList.add("dragging-active");
  });

  handle.addEventListener("pointermove", (evt: PointerEvent) => {
    if (!dragging) return;
    evt.preventDefault();
    clearDropIndicators();
    // Pointer capture routes the event here, but hit-testing still
    // reports whatever is actually under the finger.
    const under = document.elementFromPoint(evt.clientX, evt.clientY);
    const dropZone =
      under instanceof Element
        ? under.closest<HTMLElement>(".screenplay-index-card[data-range]")
        : null;
    if (!dropZone || dropZone.classList.contains("dragging")) return;
    markDropSide(dropZone, evt.clientX);
  });

  handle.addEventListener("pointerup", (evt: PointerEvent) => {
    if (!dragging) return;
    const under = document.elementFromPoint(evt.clientX, evt.clientY);
    const dropZone =
      under instanceof Element
        ? under.closest<HTMLElement>(".screenplay-index-card[data-range]")
        : null;
    const before = dropZone?.classList.contains("drop-left") ?? false;
    const after = dropZone?.classList.contains("drop-right") ?? false;
    clearDropIndicators();
    stop();
    if (!dropZone || (!before && !after)) return;
    const dstRange = cardRange(dropZone);
    const dstPath = dropZone.dataset.fountainPath;
    if (!dstRange || dstPath === undefined) return;
    performCardMove(
      { path, range },
      dstPath,
      dstRange,
      before,
      callbacks,
    );
  });

  handle.addEventListener("pointercancel", () => {
    if (!dragging) return;
    clearDropIndicators();
    stop();
  });
}

/** Adds drop-left/drop-right classes to indicate where a drop would
 land. The classes drive both the visual insertion bar and the drop
 handler's decision (so the position is computed in one place).
 No indicator is shown on the source card itself (the .dragging one). */
function dragoverHandler(
  dropZone: HTMLElement,
  dropZoneRange: Range,
  evt: DragEvent,
) {
  evt.preventDefault();
  if (dropZone.classList.contains("dragging")) {
    dropZone.classList.remove("drop-left");
    dropZone.classList.remove("drop-right");
    return;
  }
  const rect = dropZone.getBoundingClientRect();
  const clampedX = Math.min(Math.max(evt.clientX, rect.left), rect.right);
  const percentage = ((clampedX - rect.left) / rect.width) * 100;

  if (percentage >= 50) {
    dropZone.classList.add("drop-right");
    dropZone.classList.remove("drop-left");
  } else {
    dropZone.classList.add("drop-left");
    dropZone.classList.remove("drop-right");
  }
}

/** When we start dragging we store the range of the scene and use the
 whole card as the drag image (not the small handle that initiated it). */
function dragstartHandler(
  card: HTMLElement,
  path: string,
  range: Range,
  evt: DragEvent,
): void {
  if (!evt.dataTransfer) return;
  evt.dataTransfer.clearData();
  evt.dataTransfer.setData(
    "application/json",
    JSON.stringify({ path: path, range: range }),
  );
  evt.dataTransfer.effectAllowed = "move";
  try {
    evt.dataTransfer.setDragImage(card, 12, 12);
  } catch {
    // setDragImage can throw on synthetic events in some browsers; ignore.
  }
  // Mark the surrounding cards container so insertion gutters can opt
  // out of pointer events for the duration of the drag (see CSS).
  card.closest(".screenplay-index-cards")?.classList.add("dragging-active");
  // Defer so the browser snapshots the card for its drag image at full
  // opacity, then fades the original on the page.
  setTimeout(() => card.classList.add("dragging"), 0);
}

function installDragAndDropHandlers(
  path: string,
  callbacks: ReadonlyViewCallbacks,
  indexCard: HTMLElement,
  range: Range,
) {
  // The mouse path carries the source file in `dataTransfer`; a touch
  // drag resolves its target by hit-testing, so the path has to live on
  // the element itself.
  indexCard.dataset.fountainPath = path;
  indexCard.addEventListener("dragover", (evt: DragEvent) => {
    dragoverHandler(indexCard, range, evt);
  });
  indexCard.addEventListener("dragleave", (e: DragEvent) => {
    // dragleave fires when the cursor enters a child element too. Only
    // treat it as a real leave when we're moving outside the card.
    const related = e.relatedTarget as Node | null;
    if (related && indexCard.contains(related)) return;
    indexCard.classList.remove("drop-left");
    indexCard.classList.remove("drop-right");
  });
  indexCard.addEventListener("drop", (e: DragEvent) => {
    dropHandler(indexCard, path, range, callbacks, e);
  });
  indexCard.addEventListener("dragstart", (evt: DragEvent) => {
    dragstartHandler(indexCard, path, range, evt);
  });
  indexCard.addEventListener("dragend", () => {
    indexCard.classList.remove("dragging");
    indexCard
      .closest(".screenplay-index-cards")
      ?.classList.remove("dragging-active");
    clearDropIndicators();
  });
}

/** Replace the heading <h3> with an <input>; commit on Enter or blur,
 *  cancel on Esc. The committed flag avoids the re-entry that would
 *  otherwise occur when commit's `reRender` detaches the input and fires
 *  a synthetic blur on a stale node. */
function editSceneHeadingHandler(
  indexCardDiv: HTMLDivElement,
  script: FountainScript,
  headingRange: Range,
  callbacks: ReadonlyViewCallbacks,
): void {
  const heading = indexCardDiv.querySelector(".scene-heading");
  if (!heading) return;
  const headingTextWithNewlines = script.sliceDocument(headingRange);
  const headingText = headingTextWithNewlines.replace(/\n{1,2}/, "");
  const numNewlines = headingTextWithNewlines.length - headingText.length;

  const headingInput = createEl("input", {
    cls: "scene-heading",
    type: "text",
    value: headingText,
  });
  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    callbacks.replaceText(
      headingRange,
      headingInput.value + "\n".repeat(numNewlines),
    );
    callbacks.requestSave();
    callbacks.reRender();
  };
  const cancel = () => {
    if (committed) return;
    committed = true;
    callbacks.reRender();
  };
  headingInput.addEventListener("keyup", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  });
  headingInput.addEventListener("blur", () => commit());
  heading.replaceWith(headingInput);
  headingInput.focus();
  // Pre-select the heading text so typing immediately replaces the
  // placeholder (or existing heading) rather than appending to it.
  headingInput.select();
}

/** Inline rename input for a section heading. The input shows the full
 *  `## Title` form so depth and title are edited through the same gesture:
 *  `### Foo` becomes depth-3 + title "Foo"; an empty input deletes the
 *  section header line entirely (children promote to the parent on
 *  reparse); malformed input (no leading `#…`, or `####+ …` requesting
 *  a depth past the cards-view convention) cancels.
 *
 *  Pre-selects only the title portion so typing replaces the title
 *  without nuking the `#…` prefix. */
function editSectionHeadingHandler(
  row: HTMLElement,
  script: FountainScript,
  section: Section,
  callbacks: ReadonlyViewCallbacks,
): void {
  const heading = row.querySelector<HTMLElement>(".section");
  if (!heading) return;
  const fullText = script.sliceDocument(section.range);
  const hasTrailingNewline = fullText.endsWith("\n");
  // After `depth` `#` characters the parser allows arbitrary whitespace
  // before the title; collapse it to a single space on rename.
  const titleText = fullText.slice(section.depth).trim();
  const initialValue = `${"#".repeat(section.depth)} ${titleText}`;

  const computed = getComputedStyle(heading);
  const headingInput = createEl("input", {
    cls: "section",
    type: "text",
    value: initialValue,
  });
  headingInput.style.fontSize = computed.fontSize;
  headingInput.style.fontWeight = computed.fontWeight;
  headingInput.style.fontFamily = computed.fontFamily;
  headingInput.style.color = computed.color;
  headingInput.style.lineHeight = computed.lineHeight;
  // Without these, the h-tag's browser-default vertical margins
  // disappear in edit mode and the surrounding cards visibly jump.
  headingInput.style.marginTop = computed.marginTop;
  headingInput.style.marginBottom = computed.marginBottom;

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const trimmed = headingInput.value.trim();
    if (trimmed === "") {
      // Empty input deletes the section header line. The parser then
      // reparses without it, splicing any following content into the
      // parent's flow — same source-level result as deleting the `#`
      // line in the editor.
      callbacks.replaceText(section.range, "");
      callbacks.requestSave();
      callbacks.reRender();
      return;
    }
    const m = trimmed.match(/^(#+)\s+(.+)$/);
    if (!m) {
      // Malformed (e.g. no leading `#…`, or hashes without a title) —
      // refuse the save and revert to the rendered heading.
      callbacks.reRender();
      return;
    }
    const newDepth = m[1].length;
    if (newDepth > 3) {
      // The cards view only models depth 1–3 sections (the rest are
      // scene-internal subsections in `script.structure()`). Refuse
      // rather than silently truncate, so the user sees their input
      // didn't take and can re-type at a valid depth.
      callbacks.reRender();
      return;
    }
    const newTitle = m[2].trim();
    const newText =
      "#".repeat(newDepth) +
      " " +
      newTitle +
      (hasTrailingNewline ? "\n" : "");
    callbacks.replaceText(section.range, newText);
    callbacks.requestSave();
    callbacks.reRender();
  };
  const cancel = () => {
    if (committed) return;
    committed = true;
    callbacks.reRender();
  };
  headingInput.addEventListener("keyup", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  });
  headingInput.addEventListener("blur", () => commit());
  heading.replaceWith(headingInput);
  headingInput.focus();
  // Select only the title portion so typing replaces the title without
  // nuking the `#…` prefix (which would refuse the save).
  const titleStart = section.depth + 1; // hashes + single space
  headingInput.setSelectionRange(titleStart, headingInput.value.length);
}

function renderSynopsis(
  div: HTMLElement,
  script: FountainScript,
  synopsis: Synopsis | undefined,
  startPosIfEmpty: number,
  scene?: StructureScene,
): void {
  const synopsisRange = synopsis?.range || {
    start: startPosIfEmpty,
    end: startPosIfEmpty,
  };
  div.createDiv(
    {
      attr: dataRange(synopsisRange),
    },
    (div2) => {
      for (const line of synopsis?.lines ?? []) {
        const lineDiv = div2.createDiv({
          cls: "synopsis",
          attr: dataRange(line.range),
        });
        styledTextToHtml(script, lineDiv, line.elements, {}, true);
      }
      if (!synopsis) {
        const preview = scene ? getScenePreview(script, scene, 220) : null;
        if (preview) {
          div2.createDiv({
            cls: "preview",
            text: preview,
          });
        }
      }
    },
  );
}

/** Append the two stacked buttons (`+` scene, `#` section) into a hover
 *  gutter. Both buttons share a common visual; the `#` always inserts a
 *  depth-1 section so depth selection lives in the rename input only. */
function appendCardGutterButtons(
  gutter: HTMLElement,
  insertPos: number,
  callbacks: ReadonlyViewCallbacks,
): void {
  gutter.createDiv(
    {
      cls: ["gutter-btn", "gutter-btn-scene"],
      attr: { "aria-label": "Insert scene here" },
    },
    (btn) => {
      setIcon(btn, "plus");
      btn.addEventListener("click", (evt: MouseEvent) => {
        evt.stopPropagation();
        callbacks.insertSceneAt(insertPos);
      });
    },
  );
  gutter.createDiv(
    {
      cls: ["gutter-btn", "gutter-btn-section"],
      attr: { "aria-label": "Insert section here" },
    },
    (btn) => {
      btn.textContent = "#";
      btn.addEventListener("click", (evt: MouseEvent) => {
        evt.stopPropagation();
        callbacks.insertSectionAt(insertPos);
      });
    },
  );
}

/** Render an index card. The whole card click navigates to the scene; the
 *  pencil button opens an inline rename for the heading. Returns the slot
 *  element so callers can attach a right-edge insertion gutter on the
 *  last-direct-scene of a section without having to query for it. */
function renderIndexCard(
  div: HTMLElement,
  path: string,
  script: FountainScript,
  scene: StructureScene,
  callbacks: ReadonlyViewCallbacks,
): HTMLElement | null {
  if (!scene.scene) return null;
  const heading = scene.scene;
  // Use `body` not `content` for note extraction — the qualifying
  // synopsis is already rendered separately via renderSynopsis, so its
  // todos shouldn't show up a second time in the card's todo list.
  const body = scene.body;

  let slotRef: HTMLElement | null = null;
  div.createDiv({ cls: "card-slot" }, (slot) => {
    slotRef = slot;
    // Left insertion gutter — `+` (scene) and `#` (section), inserting at
    // this scene's start position.
    slot.createDiv(
      {
        cls: "insertion-gutter",
        attr: { "data-insert-pos": String(scene.range.start) },
      },
      (gutter) => {
        appendCardGutterButtons(gutter, scene.range.start, callbacks);
      },
    );

    slot.createDiv(
      {
        cls: "screenplay-index-card",
        attr: {
          ...dataRange(scene.range),
        },
      },
      (indexCard) => {
        installDragAndDropHandlers(path, callbacks, indexCard, scene.range);
        // Click anywhere on the card → navigate to scene content in editor.
        indexCard.addEventListener("click", () => {
          callbacks.navigateToSceneContent(scene.range);
        });

        indexCard.createDiv(
          {
            cls: "drag-handle",
            attr: { draggable: true, "aria-label": "Drag to reorder" },
          },
          (handle) => {
            setIcon(handle, "grip-vertical");
            installTouchDragHandlers(
              handle,
              indexCard,
              path,
              scene.range,
              callbacks,
            );
            // Clicks on the grip shouldn't navigate; mousedown still
            // initiates drag normally.
            handle.addEventListener("click", (evt: MouseEvent) => {
              evt.stopPropagation();
            });
          },
        );
        indexCard.createEl("h3", {
          cls: "scene-heading",
          attr: dataRange(heading.range),
          text: heading.heading,
        });
        indexCard.createDiv(
          {
            cls: "pencil-button",
            attr: { "aria-label": "Rename scene heading" },
          },
          (pencil) => {
            setIcon(pencil, "pencil");
            pencil.addEventListener("click", (evt: MouseEvent) => {
              evt.stopPropagation();
              editSceneHeadingHandler(
                indexCard,
                script,
                heading.range,
                callbacks,
              );
            });
          },
        );
        renderSynopsis(
          indexCard,
          script,
          scene.synopsis,
          heading.range.end,
          scene,
        );
        const todos = extractNotes(body).filter(
          (n) => n.noteKind === "todo",
        );
        for (const note of todos) {
          indexCard.createDiv({}, (div) => {
            styledTextToHtml(script, div, [note], {}, false);
            div.addEventListener("click", (evt: MouseEvent) => {
              evt.stopPropagation();
              callbacks.startEditModeHere(note.range);
            });
          });
        }
      },
    );
  });
  return slotRef;
}

/** Append a right-edge insertion gutter to a card slot. Only used on the
 *  last *direct* scene of a section: that's the position at which a new
 *  scene/section would slide in between this section's own scenes and any
 *  following sibling-section heading (or the end of the document). */
function attachRightGutter(
  slot: HTMLElement,
  insertPos: number,
  callbacks: ReadonlyViewCallbacks,
): void {
  slot.createDiv(
    {
      cls: ["insertion-gutter", "insertion-gutter-right"],
      attr: { "data-insert-pos": String(insertPos) },
    },
    (gutter) => {
      appendCardGutterButtons(gutter, insertPos, callbacks);
    },
  );
}

/** Hover-revealed horizontal bar that inserts a `# section` heading at
 *  `insertPos`. Used at the top of the doc and in the tail zone — not
 *  between every pair of sections (the vertical `#` button on the
 *  preceding section's last scene covers that). */
function renderSectionInsertBar(
  parent: HTMLElement,
  insertPos: number,
  callbacks: ReadonlyViewCallbacks,
): void {
  parent.createDiv(
    {
      cls: "section-insert-bar",
      attr: { "data-insert-pos": String(insertPos) },
    },
    (bar) => {
      bar.createDiv(
        {
          cls: "section-insert-btn",
          attr: { "aria-label": "Insert a # section here" },
        },
        (btn) => {
          btn.textContent = "+ section";
          btn.addEventListener("click", (evt: MouseEvent) => {
            evt.stopPropagation();
            callbacks.insertSectionAt(insertPos);
          });
        },
      );
    },
  );
}

/** Render a section, that is a combination of a heading followed by all the
scenes that section contains. If the document started immediately with a a scene
the section might be an unnamed section and not have a section header. */
function renderSection(
  parent: HTMLElement,
  path: string,
  script: FountainScript,
  section: StructureSection,
  callbacks: ReadonlyViewCallbacks,
): void {
  // Headerless synthetic section with no scene-bearing scenes (e.g.
  // a doc that's all action and no scene headings). The cards view
  // only renders scene cards, so there's nothing to show — and a
  // dashed `+` card here would be confusing.
  const sectionHasRenderableContent = section.content.some(
    (c) => !!c.scene,
  );
  if (!section.section && !sectionHasRenderableContent) return;

  if (section.section) {
    const sec = section.section;
    const title = script.sliceDocument(sec.range);
    // The cards view models sections of depth 1–3; deeper headings live
    // inside scenes (see `script.structure()`). Clamp defensively in
    // case some other path constructs a deeper section.
    const hTag = `h${Math.min(3, sec.depth ?? 1)}` as keyof HTMLElementTagNameMap;
    if (
      title
        .toLowerCase()
        .replace(/^ *#+ */, "")
        .trimEnd() === "boneyard"
    ) {
      parent.createEl("hr");
    }
    parent.createDiv({ cls: "section-heading-row" }, (row) => {
      row.createEl(hTag, {
        cls: "section",
        attr: { "data-start": sec.range.start },
        text: title,
      });
      row.createDiv(
        {
          cls: "pencil-button",
          attr: { "aria-label": "Rename section heading" },
        },
        (pencil) => {
          setIcon(pencil, "pencil");
          pencil.addEventListener("click", (evt: MouseEvent) => {
            evt.stopPropagation();
            editSectionHeadingHandler(row, script, sec, callbacks);
          });
        },
      );
    });
  }
  if (section.synopsis) {
    renderSynopsis(parent, script, section.synopsis, section.synopsis.range.start);
  }
  parent.createDiv({ cls: "screenplay-index-cards" }, (sectionDiv) => {
    let lastSceneSlot: HTMLElement | null = null;
    let lastSceneEnd: number | null = null;
    let renderedAnyContent = false;
    for (const el of section.content) {
      // Synthetic scenes (no `.scene` heading — usually a stray blank
      // action line at the start/end of a section) render nothing,
      // so don't count them as renderable content.
      const slot = renderIndexCard(sectionDiv, path, script, el, callbacks);
      if (slot) {
        renderedAnyContent = true;
        lastSceneSlot = slot;
        lastSceneEnd = el.range.end;
      }
    }
    // Right-edge gutter on the last *direct* scene of this section. The
    // insertion position is the boundary just past the last scene's
    // trailing blank line — which puts a new heading either before the
    // next sibling section or at end-of-doc, depending on context.
    if (lastSceneSlot && lastSceneEnd !== null) {
      attachRightGutter(lastSceneSlot, lastSceneEnd, callbacks);
    }
    // Visually-empty section: persistent dashed `+` aim point. Sections
    // that rendered actual scenes/subsections delegate "add at end" to
    // the right gutter above so the affordance budget stays small.
    if (!renderedAnyContent) {
      sectionDiv.createDiv(
        {
          cls: ["screenplay-index-card", "dashed"],
          attr: {},
        },
        (div) => {
          setIcon(div, "plus");
          div.addEventListener("click", (_evt: MouseEvent) => {
            callbacks.insertSceneAt(endOfRange(section.range).start);
          });
        },
      );
    }
  });
}

/**
 * Render a index card view of a given fountain document.
 * @param div This elements content will be replaced.
 * @param script the fountain document.
 */
export function renderIndexCards(
  div: HTMLElement,
  path: string,
  script: FountainScript,
  callbacks: ReadonlyViewCallbacks,
): void {
  const structure = script.structure();
  div.empty();

  // The structure builder always pushes at least one (possibly synthetic)
  // section, so `sections.length === 0` doesn't actually mean "empty doc"
  // — instead, look for any visible content (a real section heading, a
  // scene with a heading, or a nested section).
  const hasVisibleContent = structure.sections.some(
    (s) =>
      !!s.section || s.content.some((c) => !!c.scene),
  );

  // Top-of-doc bar: shown when the doc starts with a section heading (so
  // the user can prepend a sibling section above it) or when the doc has
  // no visible content (alongside the dashed `+` card so section-first
  // and scene-first starts both have an obvious aim point). The insert
  // position is the first section's start when one exists — that keeps a
  // title page intact when one sits in front of the section.
  const firstSection = structure.sections[0]?.section;
  if (!hasVisibleContent) {
    renderSectionInsertBar(div, 0, callbacks);
  } else if (firstSection) {
    renderSectionInsertBar(div, firstSection.range.start, callbacks);
  }

  if (!hasVisibleContent) {
    // Render the dashed `+` card inside a regular grid — same layout as
    // an empty section, so the position doesn't shift around as the user
    // adds content.
    div.createDiv({ cls: "screenplay-index-cards" }, (grid) => {
      grid.createDiv(
        {
          cls: ["screenplay-index-card", "dashed"],
          attr: { "aria-label": "Add the first scene" },
        },
        (card) => {
          setIcon(card, "plus");
          card.addEventListener("click", () => {
            callbacks.insertSceneAt(0);
          });
        },
      );
    });
  } else {
    for (const s of structure.sections) {
      renderSection(div, path, script, s, callbacks);
    }
  }

  // Tail-of-doc bar — persistent insertion at end-of-doc. Wrapped in a
  // hover zone so the bar surfaces when the cursor approaches the bottom
  // of the cards area, not just on the bar's exact pixels.
  div.createDiv({ cls: "section-tail-zone" }, (zone) => {
    renderSectionInsertBar(zone, script.document.length, callbacks);
  });
}
