import {
  ItemView,
  Menu,
  TFile,
  type ViewStateResult,
  type WorkspaceLeaf,
  debounce,
} from "obsidian";
import { findFountainViewsForPath } from "../edit_pipeline";
import {
  type FountainScript,
  type Range,
  type Snippet,
  type StructureSection,
  type Synopsis,
  dataRange,
  extractNotes,
  sceneMoveTargets,
  sectionDropPosition,
} from "../fountain";
import { titlePageFieldsOf } from "../fountain/title_page";
import { FountainView } from "../views/fountain_view";
import { renderElement } from "../views/reading_view";
import { getScenePreview } from "../views/render_tools";
import { styledTextToHtml } from "../views/styled_text";

export const VIEW_TYPE_SIDEBAR = "fountain-sidebar";

interface SidebarCallbacks {
  scrollToRange: (range: Range) => void;
  getText: (range: Range) => string;
  /** Read text from any fountain file (open or not) at the given range. */
  readFromFile: (path: string, range: Range) => Promise<string | null>;
  insertAfterSnippetsHeader: (text: string) => void;
  /** Move the scene at `range` in the active script so it starts at `pos`. */
  moveScene: (range: Range, pos: number) => void;
  /** Path of the script the outline is showing, if any. */
  scriptPath: () => string | null;
}

/** Drag payload type for reordering scenes within the outline. Scene rows
 *  also set `application/json` with the same {path, range}, which is what
 *  the Snippets section accepts, so a scene can be dragged into snippets. */
const SCENE_DRAG_TYPE = "application/x-fountain-scene";

function clearDropIndicators(root: HTMLElement): void {
  for (const el of root.querySelectorAll(".drop-before, .drop-after, .drop-into")) {
    el.removeClasses(["drop-before", "drop-after", "drop-into"]);
  }
}

abstract class SidebarSection {
  protected callbacks: SidebarCallbacks;

  constructor(callbacks: SidebarCallbacks) {
    this.callbacks = callbacks;
  }

  abstract render(
    container: HTMLElement,
    script: FountainScript,
    isEditMode: boolean,
  ): void;
}

class SnippetsSection extends SidebarSection {
  render(
    container: HTMLElement,
    script: FountainScript,
    isEditMode: boolean,
  ): void {
    const structure = script.structure();
    const hasSnippets = structure.snippets && structure.snippets.length > 0;
    if (!hasSnippets && !isEditMode) return;

    container.createDiv(
      { cls: hasSnippets ? "snippets-section" : "snippets-section-empty" },
      (sectionDiv) => {
        sectionDiv.addClass("screenplay-snippets");

        // Add drop handling
        sectionDiv.addEventListener("dragover", (event) => {
          event.preventDefault();
          sectionDiv.addClass("drag-over");
        });

        sectionDiv.addEventListener("dragleave", (event) => {
          sectionDiv.removeClass("drag-over");
        });

        sectionDiv.addEventListener("drop", async (event) => {
          // preventDefault must run synchronously, before any await, so the
          // browser doesn't fall back to its default drop handling.
          event.preventDefault();
          sectionDiv.removeClass("drag-over");

          // Index card drags carry an application/json payload of
          // {path, range}; the source file may differ from the active
          // (destination) file. Snippet-to-snippet drags use text/plain.
          const json = event.dataTransfer?.getData("application/json");
          if (json) {
            try {
              const { path, range } = JSON.parse(json) as {
                path: string;
                range: Range;
              };
              const text = await this.callbacks.readFromFile(path, range);
              if (text) {
                this.callbacks.insertAfterSnippetsHeader(
                  `${text}\n\n===\n\n`,
                );
              }
            } catch {
              // Malformed JSON — fall through to text/plain handling.
            }
            return;
          }

          const droppedText = event.dataTransfer?.getData("text/plain");
          if (droppedText) {
            this.callbacks.insertAfterSnippetsHeader(
              `${droppedText}\n\n===\n\n`,
            );
          }
        });

        if (hasSnippets) {
          sectionDiv.createEl("div", {
            text: "Snippets",
            cls: "snippets-instruction",
          });

          for (let i = 0; i < structure.snippets.length; i++) {
            const snippet = structure.snippets[i];
            this.renderSnippet(sectionDiv, script, snippet, i);
          }
        } else {
          sectionDiv.createEl("div", {
            text: "Drop selection here to create a snippet",
            cls: "snippets-instruction",
          });
        }
      },
    );
  }

  private renderSnippet(
    parent: HTMLElement,
    script: FountainScript,
    snippet: Snippet,
    index: number,
  ): void {
    const snippetRange =
      snippet.content.length > 0
        ? {
            start: snippet.content[0].range.start,
            end: snippet.content[snippet.content.length - 1].range.end,
          }
        : { start: 0, end: 0 };

    parent.createDiv(
      {
        cls: ["snippet"],
        attr: {
          draggable: "true",
          ...dataRange(snippetRange),
        },
      },
      (snippetDiv) => {
        // Add click handler to scroll to snippet location
        if (snippet.content.length > 0) {
          snippetDiv.addEventListener("click", (evt) => {
            // Don't scroll if we started a drag
            if (evt.defaultPrevented) return;
            this.callbacks.scrollToRange(snippetRange);
          });
          snippetDiv.style.cursor = "pointer";
        }

        // Add drag handlers
        snippetDiv.addEventListener("dragstart", (evt: DragEvent) => {
          if (!evt.dataTransfer) return;

          // Get the actual snippet text content
          const snippetText = this.callbacks.getText(snippetRange);
          if (!snippetText) return;

          evt.dataTransfer.clearData();
          evt.dataTransfer.setData("text/plain", snippetText);
        });

        snippetDiv.createDiv({ cls: ["screenplay"] }, (div) => {
          // Render all snippet content - CSS max-height will handle truncation
          for (const element of snippet.content) {
            renderElement(div, element, script, {});
          }
        });
      },
    );
  }
}

/** Display options for the outline, kept in the sidebar's view state so
 *  they survive reloads. */
export interface TocOptions {
  showTodos: boolean;
  showSynopsis: boolean;
}

/** Title-page Title with Fountain emphasis markers removed, else the
 *  file's basename. */
function scriptTitle(script: FountainScript, fallback: string): string {
  const title = titlePageFieldsOf(script)
    .known.Title.replace(/[*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return title || fallback;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

class TocSection extends SidebarSection {
  constructor(
    callbacks: SidebarCallbacks,
    private options: TocOptions,
    private onOptionsChange: () => void,
    private fileName: () => string,
  ) {
    super(callbacks);
  }

  render(
    container: HTMLElement,
    script: FountainScript,
    _isEditMode: boolean,
  ): void {
    container.createDiv({ cls: "toc-section" }, (sectionDiv) => {
      sectionDiv.createDiv({ cls: "screenplay-toc" }, (div) =>
        this.renderOutline(div, script),
      );
    });
  }

  private renderOutline(div: HTMLElement, script: FountainScript) {
    const sections = script.structure().sections;
    const sceneCount = sections.reduce(
      (n, s) => n + s.content.filter((el) => el.scene).length,
      0,
    );
    const sectionCount = sections.filter((s) => s.section).length;

    div.createDiv({ cls: "toc-header" }, (header) => {
      header.createDiv({ cls: "toc-eyebrow", text: "OUTLINE" });
      header.createEl("h2", {
        cls: "toc-title",
        text: scriptTitle(script, this.fileName()),
      });
      header.createDiv({
        cls: "toc-muted",
        text: `${plural(sceneCount, "scene")} · ${plural(sectionCount, "section")}`,
      });
    });

    div.createDiv({ cls: "toc-controls" }, (controls) => {
      const toggle = (label: string, key: keyof TocOptions) => {
        const b = controls.createEl("button", { text: label });
        b.type = "button";
        b.addEventListener("click", () => {
          this.options[key] = !this.options[key];
          this.onOptionsChange();
          div.empty();
          this.renderOutline(div, script);
        });
      };
      toggle(
        this.options.showSynopsis ? "Hide synopses" : "Show synopses",
        "showSynopsis",
      );
      toggle(this.options.showTodos ? "Hide todos" : "Show todos", "showTodos");
    });

    if (sceneCount === 0 && sectionCount === 0) {
      div.createDiv({
        cls: "toc-empty",
        text: "Add a scene heading or a # section to build the outline.",
      });
      return;
    }

    for (const section of sections) {
      this.renderTocSection(div, script, section);
    }
  }

  private renderSynopsis(
    s: HTMLElement,
    script: FountainScript,
    synopsis?: Synopsis,
  ) {
    if (synopsis && this.options.showSynopsis) {
      for (const line of synopsis.lines) {
        const d = s.createDiv({
          cls: "synopsis",
          attr: dataRange(line.range),
        });
        styledTextToHtml(script, d, line.elements, {}, true);
        d.addEventListener("click", (evt: Event) => {
          this.callbacks.scrollToRange(line.range);
        });
      }
    }
  }

  private renderTocSection(
    parent: HTMLElement,
    script: FountainScript,
    section: StructureSection,
  ) {
    const depth = section.section?.depth ?? 1;
    parent.createEl("section", { cls: `toc-depth-${depth}` }, (s) => {
      if (section.section) {
        const sect = section.section;
        s.createDiv({ cls: "toc-section-heading" }, (row) => {
          const d = row.createEl("h3", {
            cls: "section",
            // The range includes the leading #s; show only the title.
            text: script.sliceDocument(sect.range).slice(sect.depth).trim(),
          });
          d.addEventListener("click", () => {
            this.callbacks.scrollToRange(sect.range);
          });
          // Dropping a scene on a heading moves it to the section's start.
          this.installDropTarget(parent, row, () => "drop-into", () =>
            sectionDropPosition(section),
          );
        });
      }
      this.renderSynopsis(s, script, section.synopsis);
      for (const el of section.content) {
        const row = el.scene ? s.createDiv({ cls: "toc-scene" }) : s;
        if (el.scene) {
          const el_scene = el.scene;
          const d = row.createDiv({
            cls: "scene-heading",
            text: el_scene.heading,
          });
          d.addEventListener("click", () => {
            this.callbacks.scrollToRange(el_scene.range);
          });
          this.installSceneReordering(parent, row, script, el.range);
        }
        if (el.synopsis) {
          this.renderSynopsis(row, script, el.synopsis);
        } else if (this.options.showSynopsis) {
          const preview = getScenePreview(script, el);
          if (preview) row.createDiv({ cls: "preview", text: preview });
        }
        if (!this.options.showTodos) continue;
        // Use `.body` not `.content` so the qualifying synopsis (already
        // rendered above) doesn't have its todos surface again here.
        const todos = extractNotes(el.body).filter(
          (n) => n.noteKind === "todo",
        );
        for (const note of todos) {
          row.createDiv({ cls: "todo" }, (div) => {
            styledTextToHtml(script, div, [note], {}, false);
            div.addEventListener("click", () =>
              this.callbacks.scrollToRange(note.range),
            );
          });
        }
      }
    });
  }

  /** Make a scene row draggable, accept scene drops above or below it, and
   *  give it a ••• menu with Move up / Move down for touch and keyboard
   *  (HTML5 drag-and-drop doesn't fire from touch on iPad). */
  private installSceneReordering(
    outline: HTMLElement,
    row: HTMLElement,
    script: FountainScript,
    range: Range,
  ) {
    row.draggable = true;
    row.addEventListener("dragstart", (evt: DragEvent) => {
      const path = this.callbacks.scriptPath();
      if (!evt.dataTransfer || !path) return;
      const payload = JSON.stringify({ path, range });
      evt.dataTransfer.setData(SCENE_DRAG_TYPE, payload);
      evt.dataTransfer.setData("application/json", payload);
      evt.dataTransfer.effectAllowed = "copyMove";
      setTimeout(() => row.addClass("dragging"), 0);
    });
    row.addEventListener("dragend", () => {
      row.removeClass("dragging");
      clearDropIndicators(outline);
    });
    this.installDropTarget(
      outline,
      row,
      (evt) => {
        const rect = row.getBoundingClientRect();
        return evt.clientY < rect.top + rect.height / 2
          ? "drop-before"
          : "drop-after";
      },
      (side) => (side === "drop-before" ? range.start : range.end),
    );

    const more = row.createEl("button", {
      cls: "toc-more",
      text: "•••",
      attr: { "aria-label": "Move scene" },
    });
    more.type = "button";
    more.addEventListener("click", (evt: MouseEvent) => {
      evt.stopPropagation();
      const { up, down } = sceneMoveTargets(script, range.start);
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("Move up")
          .setIcon("arrow-up")
          .setDisabled(up === null)
          .onClick(() => up !== null && this.callbacks.moveScene(range, up)),
      );
      menu.addItem((item) =>
        item
          .setTitle("Move down")
          .setIcon("arrow-down")
          .setDisabled(down === null)
          .onClick(
            () => down !== null && this.callbacks.moveScene(range, down),
          ),
      );
      menu.showAtMouseEvent(evt);
    });
  }

  /** Accept scene drags on `target`. `side` picks the indicator class from
   *  the pointer position; `position` maps that class to the insertion
   *  offset passed to `moveScene`. Drags from another file are ignored. */
  private installDropTarget(
    outline: HTMLElement,
    target: HTMLElement,
    side: (evt: DragEvent) => string,
    position: (side: string) => number,
  ) {
    target.addEventListener("dragover", (evt: DragEvent) => {
      if (!evt.dataTransfer?.types.includes(SCENE_DRAG_TYPE)) return;
      evt.preventDefault();
      evt.stopPropagation();
      evt.dataTransfer.dropEffect = "move";
      clearDropIndicators(outline);
      if (!target.hasClass("dragging")) target.addClass(side(evt));
    });
    target.addEventListener("dragleave", (evt: DragEvent) => {
      const related = evt.relatedTarget as Node | null;
      if (related && target.contains(related)) return;
      target.removeClasses(["drop-before", "drop-after", "drop-into"]);
    });
    target.addEventListener("drop", (evt: DragEvent) => {
      const raw = evt.dataTransfer?.getData(SCENE_DRAG_TYPE);
      if (!raw) return;
      evt.preventDefault();
      evt.stopPropagation();
      const chosen = ["drop-before", "drop-after", "drop-into"].find((c) =>
        target.hasClass(c),
      );
      clearDropIndicators(outline);
      if (!chosen) return;
      const { path, range } = JSON.parse(raw) as { path: string; range: Range };
      if (path !== this.callbacks.scriptPath()) return;
      this.callbacks.moveScene(range, position(chosen));
    });
  }
}

// TODO: In an ideal world, instead of registering an additional view, we
// would take over the normal outline view (so that for markdown views the
// regular outline view does its job but for foutainview's our view does
// what it should...)
export class FountainSideBarView extends ItemView {
  private updateToc: () => void;
  private sections: SidebarSection[];
  private options: TocOptions = { showTodos: true, showSynopsis: false };

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.updateToc = debounce(() => this.render(), 500, true);

    const callbacks: SidebarCallbacks = {
      scrollToRange: (range: Range) => this.scrollActiveScriptToHere(range),
      getText: (range: Range) => this.getText(range),
      readFromFile: (path: string, range: Range) =>
        this.readFromFile(path, range),
      insertAfterSnippetsHeader: (text: string) =>
        this.insertAfterSnippetsHeader(text),
      moveScene: (range: Range, pos: number) => {
        // The edit pipeline updates the view's script synchronously, so
        // the outline can redraw straight away instead of waiting for the
        // debounced refresh after the file write.
        this.theFountainView()?.moveScene(range, pos);
        this.render();
      },
      scriptPath: () => this.theFountainView()?.file?.path ?? null,
    };

    this.sections = [
      new TocSection(
        callbacks,
        this.options,
        () => this.app.workspace.requestSaveLayout(),
        () => this.theFountainView()?.file?.basename ?? "Untitled",
      ),
      new SnippetsSection(callbacks),
    ];
  }

  /** Read a slice of text from `path`, preferring an open FountainView's
   *  cached script (which may carry typed-but-unsaved CM state) and
   *  falling back to a vault read. */
  private async readFromFile(
    path: string,
    range: Range,
  ): Promise<string | null> {
    const views = findFountainViewsForPath(this.app, path);
    if (views.length > 0) return views[0].getText(range);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const txt = await this.app.vault.read(file);
      return txt.slice(range.start, range.end);
    }
    return null;
  }

  getViewType(): string {
    return VIEW_TYPE_SIDEBAR;
  }

  getDisplayText(): string {
    return "Fountain Outline";
  }

  getIcon(): string {
    return "list-tree";
  }

  getState(): Record<string, unknown> {
    return { ...super.getState(), ...this.options };
  }

  async setState(
    state: Partial<TocOptions>,
    result: ViewStateResult,
  ): Promise<void> {
    if (typeof state?.showTodos === "boolean")
      this.options.showTodos = state.showTodos;
    if (typeof state?.showSynopsis === "boolean")
      this.options.showSynopsis = state.showSynopsis;
    await super.setState(state, result);
    this.updateToc();
  }

  async onload(): Promise<void> {
    this.registerEvent(
      this.app.workspace.on(
        "active-leaf-change",
        (leaf: WorkspaceLeaf | null) => {
          if (leaf?.view !== this) this.updateToc();
        },
      ),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file.name.endsWith(".fountain")) {
          this.updateToc();
        }
      }),
    );
  }

  private scrollActiveScriptToHere(range: Range) {
    // In the moment of clicking on a toc element, the toc is active
    // so let's see if before that a fountainview was active.
    this.theFountainView()?.scrollToHere(range);
  }

  private theFountainView(): FountainView | null {
    const leaf = this.app.workspace.getMostRecentLeaf(
      this.app.workspace.rootSplit,
    );
    if (leaf && leaf.view instanceof FountainView) {
      const ft = leaf.view;
      return ft;
    }
    return null;
  }

  private getText(range: Range): string {
    const ft = this.theFountainView();
    return ft?.getText(range) ?? "";
  }

  private insertAfterSnippetsHeader(text: string) {
    const ft = this.theFountainView();
    if (!ft) return;

    const script = ft.getScript();

    // Find the "# Snippets" header position
    let snippetsHeaderEnd: number | null = null;
    for (const element of script.script) {
      if (element.kind === "section") {
        const sectionText = script.document.slice(
          element.range.start,
          element.range.end,
        );
        if (sectionText.toLowerCase().includes("snippets")) {
          snippetsHeaderEnd = element.range.end;
          break;
        }
      }
    }

    if (snippetsHeaderEnd !== null) {
      // Insert text right after the snippets header
      ft.replaceText(
        { start: snippetsHeaderEnd, end: snippetsHeaderEnd },
        `\n\n${text}`,
      );
    } else {
      // If no snippets section exists, add it at the end
      const docLength = script.document.length;
      const snippetsSection = `\n\n# Boneyard\n# Snippets\n${text}`;
      ft.replaceText({ start: docLength, end: docLength }, snippetsSection);
    }
  }

  private render() {
    const ft = this.theFountainView();
    const container = this.contentEl;
    container.empty();

    // Create the main sidebar container
    container.createDiv({ cls: "sidebar-container" }, (sidebarDiv) => {
      if (ft) {
        const script = ft.getScript();
        const isEditMode = ft.isEditMode();
        for (const section of this.sections) {
          section.render(sidebarDiv, script, isEditMode);
        }
      } else {
        sidebarDiv.createDiv({
          cls: "screenplay-toc toc-empty",
          text: "Open a Fountain script to see its outline.",
        });
      }
    });
  }

  protected async onOpen(): Promise<void> {
    this.updateToc();
  }

  protected async onClose(): Promise<void> {
    // nothing to clean up
  }
}
