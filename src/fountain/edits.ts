import type { FountainScript } from "./script";
import type { Range, SceneHeading } from "./types";
import { sceneHeadingTextEnd } from "./utils";

export interface Edit {
  range: Range;
  replacement: string;
}

/**
 * Apply a batch of edits to `text`. Ranges are interpreted against the
 * pre-edit `text`; edits must be non-overlapping. Edits are applied from
 * right to left so earlier positions stay valid during application.
 */
export function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.range.start - a.range.start);
  let result = text;
  for (const e of sorted) {
    result =
      result.slice(0, e.range.start) +
      e.replacement +
      result.slice(e.range.end);
  }
  return result;
}

/** Return the newline characters needed so `text` ends with "\n\n". */
function trailingNewlinesNeeded(text: string): string {
  const lastTwo = text.slice(-2);
  return lastTwo === "\n\n" ? "" : lastTwo[1] === "\n" ? "\n" : "\n\n";
}

/** How many leading newlines must precede text inserted at `pos` so it
 *  starts at column 0 after a blank line. Scene headings *require* the
 *  blank line when following Action (without it `INT. FOO - DAY` is
 *  absorbed as Action text), which matters when a moved scene lands right
 *  after a section heading. */
function newlinesNeededBefore(doc: string, pos: number): string {
  if (pos === 0) return "";
  const before = doc.slice(Math.max(0, pos - 2), pos);
  if (before.endsWith("\n\n")) return "";
  if (before.endsWith("\n")) return "\n";
  return "\n\n";
}

/**
 * Edits to move the scene-sized `range` so its content starts at `newPos`.
 * `newPos` must not lie inside `range`.
 */
export function computeMoveSceneEdits(
  script: FountainScript,
  range: Range,
  newPos: number,
): Edit[] {
  const sceneText = script.document.slice(range.start, range.end);
  return [
    { range: { start: range.start, end: range.end }, replacement: "" },
    {
      range: { start: newPos, end: newPos },
      replacement:
        newlinesNeededBefore(script.document, newPos) +
        sceneText +
        trailingNewlinesNeeded(sceneText),
    },
  ];
}

function scenesOf(script: FountainScript): SceneHeading[] {
  return script.script.filter(
    (element): element is SceneHeading => element.kind === "scene",
  );
}

/**
 * Edits that add sequential scene numbers to every scene lacking one.
 * Numbering continues from any purely-numeric existing number; non-numeric
 * numbers (e.g. "5A") leave the counter untouched.
 */
export function computeAddSceneNumberEdits(script: FountainScript): Edit[] {
  const edits: Edit[] = [];
  let next = 1;
  for (const scene of scenesOf(script)) {
    if (scene.number === null) {
      const insertPosition = sceneHeadingTextEnd(scene);
      edits.push({
        range: { start: insertPosition, end: insertPosition },
        replacement: ` #${next}#`,
      });
      next++;
      continue;
    }
    const existing = script.document.substring(
      scene.number.start + 1,
      scene.number.end - 1,
    );
    const parsed = Number.parseInt(existing, 10);
    if (!Number.isNaN(parsed) && parsed.toString() === existing.trim()) {
      next = parsed + 1;
    }
  }
  return edits;
}

/** Edits that strip every existing scene number (plus preceding whitespace). */
export function computeRemoveSceneNumberEdits(script: FountainScript): Edit[] {
  const edits: Edit[] = [];
  for (const scene of scenesOf(script)) {
    if (scene.number === null) continue;
    const beforeNumber = script.document.substring(
      sceneHeadingTextEnd(scene),
      scene.number.start,
    );
    const trailingWs = beforeNumber.match(/\s*$/)?.[0] ?? "";
    edits.push({
      range: {
        start: scene.number.start - trailingWs.length,
        end: scene.number.end,
      },
      replacement: "",
    });
  }
  return edits;
}
