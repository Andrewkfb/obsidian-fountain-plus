import type { Edit } from "./edits";
import type { FountainScript } from "./script";

/// Pure helpers for reading and writing Fountain title pages. The modal
/// that drives them lives in `src/title_page_command.ts`.
///
/// Four parser constraints shape everything here — all of them will
/// silently produce "no title page at all" rather than a partial one, so
/// the writer has to respect them exactly:
///
/// 1. A key with an empty value (`Title:` with nothing after it) makes
///    the *whole* block fail to parse. Empty fields must be omitted, not
///    emitted blank.
/// 2. The block must be followed by a blank line. `Title: X\n` on its own
///    is not a title page; `Title: X\n\n` is.
/// 3. It must be the very first thing in the file.
/// 4. Multi-line values continue on lines indented by 3+ spaces.
///
/// `TitlePage.range` already covers the trailing blank line, so replacing
/// or deleting a title page is a single-range edit.

/** Keys the plugin offers as dedicated fields, in the order Fountain
 *  convention puts them on the page. Matching against a parsed document
 *  is case-insensitive; these spellings are what we write back out. */
export const TITLE_PAGE_KEYS = [
  "Title",
  "Credit",
  "Author",
  "Source",
  "Draft date",
  "Contact",
] as const;

export type TitlePageKey = (typeof TITLE_PAGE_KEYS)[number];

/** A title page as the dialog edits it: the known fields by key, plus any
 *  other keys the document had, preserved in their original order so
 *  round-tripping never discards a writer's custom field. */
export interface TitlePageFields {
  known: Record<TitlePageKey, string>;
  /** Keys outside `TITLE_PAGE_KEYS`, as `[key, value]` in document order.
   *  Values keep their embedded newlines for multi-line entries. */
  other: [string, string][];
}

export function emptyTitlePageFields(): TitlePageFields {
  return {
    known: {
      Title: "",
      Credit: "",
      Author: "",
      Source: "",
      "Draft date": "",
      Contact: "",
    },
    other: [],
  };
}

/** The canonical spelling of `key` if it is one of ours, else null. */
function canonicalKey(key: string): TitlePageKey | null {
  const lower = key.trim().toLowerCase();
  for (const known of TITLE_PAGE_KEYS) {
    if (known.toLowerCase() === lower) return known;
  }
  return null;
}

/**
 * Read `script`'s title page into editable fields. A document with no
 * title page yields all-empty fields, which is exactly what the "create"
 * flow wants.
 *
 * Multi-line values are joined with "\n"; `renderTitlePageBlock` turns
 * them back into indented continuation lines.
 */
export function titlePageFieldsOf(script: FountainScript): TitlePageFields {
  const fields = emptyTitlePageFields();
  const titlePage = script.titlePage;
  if (titlePage === null) return fields;

  for (const kv of titlePage.keyValues) {
    // Values are `StyledText` spans over the document; slicing the source
    // keeps the writer's own markup (`*Star* Wars` stays italic markup
    // rather than being flattened or escaped).
    const value = kv.values
      .map((line) =>
        line
          .map((span) => script.sliceDocument(span.range))
          .join("")
          .trim(),
      )
      .filter((line) => line.length > 0)
      .join("\n");

    const known = canonicalKey(kv.key);
    if (known !== null) {
      // A duplicate key keeps the first value; the second would be
      // unreachable in a single-field-per-key form anyway.
      if (fields.known[known] === "") fields.known[known] = value;
    } else {
      fields.other.push([kv.key.trim(), value]);
    }
  }
  return fields;
}

/** Render one `Key: value` entry, using indented continuation lines when
 *  the value spans several lines. Assumes a non-empty value. */
function renderEntry(key: string, value: string): string {
  const lines = value.split("\n").map((l) => l.trim());
  if (lines.length === 1) return `${key}: ${lines[0]}\n`;
  // 3-space indent is the parser's `MultiLineValue` continuation marker.
  return `${key}:\n${lines.map((l) => `   ${l}`).join("\n")}\n`;
}

/**
 * Render `fields` as Fountain title page source, including the trailing
 * blank line that terminates the block. Fields whose value is blank are
 * omitted entirely — emitting `Title:` with no value would stop the whole
 * block from parsing.
 *
 * Returns "" when every field is blank, which callers use to mean
 * "remove the title page".
 */
export function renderTitlePageBlock(fields: TitlePageFields): string {
  const entries: string[] = [];

  for (const key of TITLE_PAGE_KEYS) {
    const value = fields.known[key].trim();
    if (value.length > 0) entries.push(renderEntry(key, value));
  }
  for (const [key, value] of fields.other) {
    const trimmedKey = key.trim();
    const trimmedValue = value.trim();
    if (trimmedKey.length === 0 || trimmedValue.length === 0) continue;
    entries.push(renderEntry(trimmedKey, trimmedValue));
  }

  if (entries.length === 0) return "";
  return `${entries.join("")}\n`;
}

/**
 * Edits that make `script`'s title page match `fields`.
 *
 * Replaces the existing block (its range already includes the trailing
 * blank line), or inserts at offset 0 when there is none. Returns [] when
 * nothing would change, so a no-op dialog confirm doesn't touch the file
 * or the undo stack.
 */
export function computeTitlePageEdits(
  script: FountainScript,
  fields: TitlePageFields,
): Edit[] {
  const block = renderTitlePageBlock(fields);
  const existing = script.titlePage;

  if (existing === null) {
    if (block === "") return [];
    // A document that is entirely empty, or whose body we'd otherwise run
    // straight into, still parses correctly: `block` ends with the blank
    // line that terminates the title page.
    return [{ range: { start: 0, end: 0 }, replacement: block }];
  }

  if (script.sliceDocument(existing.range) === block) return [];
  return [{ range: existing.range, replacement: block }];
}

/** Does `fields` contain anything at all? Used to label the dialog's
 *  confirm button and to warn before removing a title page. */
export function titlePageFieldsAreEmpty(fields: TitlePageFields): boolean {
  return renderTitlePageBlock(fields) === "";
}
