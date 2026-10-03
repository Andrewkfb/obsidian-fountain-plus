import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { fountainExtensionRange, stripFountainExtension } from "./link_display";

export { hideFountainExtensionInLinks, hideFountainExtensionInLivePreview };

/// Reading view: rewrite the text of unaliased `[[foo.fountain]]` links.
function hideFountainExtensionInLinks(element: HTMLElement) {
  for (const link of element.findAll("a.internal-link")) {
    const href = link.getAttribute("data-href") ?? link.getAttribute("href");
    const text = link.textContent;
    if (!href || !text) continue;
    const shown = stripFountainExtension(text, href);
    if (shown !== text) link.textContent = shown;
  }
}

const hidden = Decoration.replace({});

/// Live Preview: hide the `.fountain` part of unaliased wikilinks. Like
/// Obsidian's own link rendering, the raw source comes back while the
/// selection touches the link, so it can still be edited.
function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  if (!state.field(editorLivePreviewField, false)) return builder.finish();
  let lastFrom = -1;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.type.name;
        if (
          !name.includes("hmd-internal-link") ||
          name.includes("link-alias") ||
          name.includes("link-has-alias") ||
          name.includes("formatting") ||
          name.includes("embed")
        ) {
          return;
        }
        const range = fountainExtensionRange(
          state.doc.sliceString(node.from, node.to),
        );
        if (!range) return;
        const line = state.doc.lineAt(node.from);
        const open = state.doc
          .sliceString(line.from, node.from)
          .lastIndexOf("[[");
        const close = state.doc.sliceString(node.to, line.to).indexOf("]]");
        if (open === -1 || close === -1) return;
        const linkFrom = line.from + open;
        const linkTo = node.to + close + 2;
        const touched = state.selection.ranges.some(
          (r) => r.from <= linkTo && r.to >= linkFrom,
        );
        const hideFrom = node.from + range.start;
        if (touched || hideFrom <= lastFrom) return;
        builder.add(hideFrom, node.from + range.end, hidden);
        lastFrom = hideFrom;
      },
    });
  }
  return builder.finish();
}

const hideFountainExtensionInLivePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      const modeChanged =
        update.startState.field(editorLivePreviewField, false) !==
        update.state.field(editorLivePreviewField, false);
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        modeChanged
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
