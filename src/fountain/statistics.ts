import type { FountainScript } from "./script";
import type { Dialogue, FountainElement } from "./types";
import { dialogueLines } from "./utils";

/// Script statistics — the numbers a writer actually asks about: how
/// long is it, how many scenes, and who talks the most.
///
/// Page count is the interesting one. A screenplay's length is defined
/// by how it *paginates*, not by character count, so this reuses the
/// PDF pipeline's own pagination rather than approximating. That
/// pipeline is free of `pdf-lib` (only the renderer touches it), so
/// counting pages doesn't drag the PDF library back onto the load path.

export interface CharacterStats {
  name: string;
  /** Number of separate speeches — a character cue and the lines under
   *  it count once, however many lines they run to. */
  speeches: number;
  /** Number of spoken lines, excluding parentheticals. */
  lines: number;
  /** Words spoken, again excluding parentheticals. */
  words: number;
}

export interface ScriptStatistics {
  pages: number | null;
  scenes: number;
  /** Depth-≤-3 section headings, i.e. what the outline treats as
   *  structure. */
  sections: number;
  actionParagraphs: number;
  dialogueBlocks: number;
  /** Per character, busiest first. */
  characters: CharacterStats[];
  totalWords: number;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/** Text of a dialogue's spoken lines, parentheticals excluded — a
 *  `(beat)` isn't dialogue anyone says. */
function spokenTextOf(script: FountainScript, dialogue: Dialogue): string[] {
  return dialogueLines(dialogue)
    .map((line) => script.sliceDocument(line.range).trim())
    .filter((line) => line.length > 0);
}

/**
 * Compute statistics for `script`.
 *
 * `pageCount` is injected rather than imported so this module stays a
 * pure function of the script: the caller decides whether paginating is
 * worth it, and tests can check the rest of the numbers without running
 * the PDF pipeline. Pass `null` to report an unknown page count.
 */
export function computeStatistics(
  script: FountainScript,
  pageCount: number | null,
): ScriptStatistics {
  let scenes = 0;
  let sections = 0;
  let actionParagraphs = 0;
  let dialogueBlocks = 0;
  let totalWords = 0;

  const byCharacter = new Map<string, CharacterStats>();

  const statsFor = (name: string): CharacterStats => {
    const existing = byCharacter.get(name);
    if (existing) return existing;
    const created = { name, speeches: 0, lines: 0, words: 0 };
    byCharacter.set(name, created);
    return created;
  };

  for (const element of script.script as FountainElement[]) {
    switch (element.kind) {
      case "scene":
        scenes++;
        break;

      case "section":
        // Depth ≥ 4 headings are scene-internal subsections rather than
        // structure, matching how `structure()` treats them.
        if (element.depth <= 3) sections++;
        break;

      case "action": {
        // The parser merges consecutive action into one element, with
        // blank lines represented as empty Lines. Count runs of
        // non-empty lines, so one element can hold several paragraphs.
        let inParagraph = false;
        for (const line of element.lines) {
          const text = script.sliceDocument(line.range).trim();
          if (text.length === 0) {
            inParagraph = false;
            continue;
          }
          if (!inParagraph) {
            actionParagraphs++;
            inParagraph = true;
          }
          totalWords += countWords(text);
        }
        break;
      }

      case "dialogue": {
        dialogueBlocks++;
        const spoken = spokenTextOf(script, element);
        const words = spoken.reduce((sum, line) => sum + countWords(line), 0);
        totalWords += words;
        // A cue may name several characters (`MARY & BOB`); credit the
        // speech to each of them.
        for (const name of script.charactersOf(element)) {
          if (name.length === 0) continue;
          const stats = statsFor(name);
          stats.speeches++;
          stats.lines += spoken.length;
          stats.words += words;
        }
        break;
      }

      default:
        break;
    }
  }

  const characters = Array.from(byCharacter.values()).sort(
    (a, b) => b.words - a.words || a.name.localeCompare(b.name),
  );

  return {
    pages: pageCount,
    scenes,
    sections,
    actionParagraphs,
    dialogueBlocks,
    characters,
    totalWords,
  };
}
