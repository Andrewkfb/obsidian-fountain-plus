import type {
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import type { FountainScript } from "../fountain";

/// Autocompletion for scene headings.
///
/// Two things get completed, because they are what a writer actually
/// retypes: the small set of sluglines Fountain recognises (`INT.`,
/// `EXT.`, …) and — once one of those is in place — the locations
/// already used elsewhere in the script. Reusing an existing location
/// verbatim matters beyond saving keystrokes: scene headings are
/// matched as strings by the index cards, the outline, and every
/// downstream production tool, so `INT. MAYA'S KITCHEN - NIGHT` and
/// `INT. MAYAS KITCHEN - NIGHT` silently become two different places.

/** Prefixes the Fountain spec treats as scene headings. */
const SCENE_PREFIXES = [
  "INT. ",
  "EXT. ",
  "INT./EXT. ",
  "EXT./INT. ",
  "I/E. ",
  "EST. ",
];

/** A partially-typed slugline at the very start of a line: optional
 *  forcing `.`, then uppercase letters, dots and slashes. Anchored to
 *  the line start so mid-sentence capitals never trigger it. */
const SCENE_PREFIX_PATTERN = /^\.?[A-Z/.]*$/;

/** A scene heading whose prefix is complete, capturing what follows so
 *  the location list can be filtered by it. */
const AFTER_PREFIX_PATTERN =
  /^\.?(?:INT\.|EXT\.|INT\.\/EXT\.|EXT\.\/INT\.|I\/E\.|EST\.)[ \t]+(.*)$/;

/** The location part of a heading — everything after the slugline. */
function locationOf(heading: string): string | null {
  const match = AFTER_PREFIX_PATTERN.exec(heading.trim());
  if (match === null) return null;
  const location = match[1].trim();
  return location.length > 0 ? location : null;
}

/** Every distinct location already used in the script, most recently
 *  used first — a writer is far more likely to be returning to a place
 *  they just left than to one from page three. */
export function knownLocations(script: FountainScript): string[] {
  const seen = new Set<string>();
  const locations: string[] = [];
  // Walk backwards so a repeated location is remembered at its *latest*
  // use: deduplicating forwards would rank a place by the first time it
  // appeared, which is the opposite of "most recently used".
  for (let i = script.script.length - 1; i >= 0; i--) {
    const element = script.script[i];
    if (element.kind !== "scene") continue;
    // `heading` excludes the scene number, so two takes on the same
    // location don't differ by their `#12#`.
    const location = locationOf(element.heading);
    if (location === null) continue;
    const key = location.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push(location);
  }
  return locations;
}

/** Text from the start of the line up to the cursor, or null when the
 *  cursor isn't on the first line-position that could start a heading. */
function lineHeadBeforeCursor(context: CompletionContext): {
  text: string;
  from: number;
} | null {
  const line = context.state.doc.lineAt(context.pos);
  return { text: line.text.slice(0, context.pos - line.from), from: line.from };
}

/**
 * Completion source for scene headings. Offers slugline prefixes while
 * one is being typed, then known locations once the prefix is complete.
 */
export function createSceneCompletionSource(
  getScript: () => FountainScript,
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const head = lineHeadBeforeCursor(context);
    if (head === null) return null;
    const { text, from } = head;

    // Phase 2: the slugline is complete, so complete the location.
    const afterPrefix = AFTER_PREFIX_PATTERN.exec(text);
    if (afterPrefix !== null) {
      const typed = afterPrefix[1];
      const locations = knownLocations(getScript()).filter((location) =>
        location.toUpperCase().startsWith(typed.toUpperCase()),
      );
      if (locations.length === 0) return null;
      return {
        // Replace just the location part, leaving the prefix alone.
        from: from + text.length - typed.length,
        options: locations.map((location) => ({
          label: location,
          type: "keyword",
          apply: location,
        })),
      };
    }

    // Phase 1: still typing the slugline itself. An empty line offers
    // every prefix; anything typed narrows the list.
    if (!SCENE_PREFIX_PATTERN.test(text)) return null;
    const forced = text.startsWith(".");
    const typed = forced ? text.slice(1) : text;
    // A bare `.` is Fountain's forced-heading marker; with nothing after
    // it yet, every prefix is still a candidate.
    const matches = SCENE_PREFIXES.filter((prefix) =>
      prefix.startsWith(typed),
    );
    // Nothing typed and no forcing dot would pop the list open on every
    // empty line, which is noise rather than help.
    if (typed.length === 0 && !forced) return null;
    if (matches.length === 0) return null;

    return {
      from: forced ? from + 1 : from,
      options: matches.map((prefix) => ({
        label: prefix.trimEnd(),
        type: "keyword",
        apply: prefix,
      })),
    };
  };
}
