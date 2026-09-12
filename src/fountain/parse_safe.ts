import { mkAction, mkLine, mkText } from "./ast";
import { parse } from "./parser";
import { FountainScript } from "./script";
import type { Line } from "./types";

/// The parser is meant to be **total**: any string is a valid Fountain
/// document, because anything the grammar doesn't recognise should fall
/// through to an action line. `readonly_view_state.ts` has said as much
/// in a comment for a long time.
///
/// The generated Peggy parser doesn't actually guarantee that — it throws
/// a `SyntaxError` when no rule matches — and the places that guarded
/// against failure did it by testing `"error" in script`, which is always
/// false because `parse()` returns a `FountainScript` or throws. So the
/// guards never ran, and a grammar hole reached the editor as an
/// exception thrown inside a CodeMirror `StateField` update.
///
/// `parseFountain` closes that gap by making totality true by
/// construction. Call it instead of `parse()` everywhere outside the
/// parser's own tests: consumers then never need an error branch, which
/// is why none of them have one any more.

/** Render `text` as a single action element, one Line per source line.
 *  This is the "everything is action" reading the grammar is supposed to
 *  fall back to on its own. */
function allActionLines(text: string): FountainScript {
  const documentRange = { start: 0, end: text.length };
  const lines: Line[] = [];
  let offset = 0;

  for (const raw of text.split("\n")) {
    const end = offset + raw.length;
    // An empty source line is an empty Line, matching how the grammar
    // represents blank lines (no elements, not a zero-length text span).
    lines.push(
      mkLine(
        { start: offset, end },
        raw.length > 0 ? [mkText({ start: offset, end })] : [],
      ),
    );
    offset = end + 1; // step over the "\n"
  }

  return new FountainScript(text, null, [mkAction(documentRange, lines)]);
}

/**
 * Parse `text`, falling back to an all-action-lines reading if the
 * grammar rejects it.
 *
 * The fallback is a real, well-formed `FountainScript` over the same
 * document, so ranges stay valid and the writer still sees their text —
 * unformatted for that keystroke rather than not at all.
 *
 * A fallback means the grammar has a hole worth fixing, so it logs. It
 * is deliberately not a `Notice`: this can fire on every keystroke while
 * a document is briefly unparseable, and a burst of toasts would be
 * worse than the degraded formatting.
 */
export function parseFountain(text: string): FountainScript {
  try {
    return parse(text, {});
  } catch (error) {
    console.error(
      "fountain: parser rejected the document — falling back to action lines. " +
        "This is a grammar bug, please report it.",
      error,
    );
    return allActionLines(text);
  }
}
