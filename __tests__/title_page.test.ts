import { describe, expect, test } from "@jest/globals";
import { applyEdits } from "../src/fountain/edits";
import { parse } from "../src/fountain/parser";
import {
  computeTitlePageEdits,
  emptyTitlePageFields,
  renderTitlePageBlock,
  titlePageFieldsAreEmpty,
  titlePageFieldsOf,
} from "../src/fountain/title_page";
import type { TitlePageFields } from "../src/fountain/title_page";

function fields(
  known: Partial<TitlePageFields["known"]> = {},
  other: [string, string][] = [],
): TitlePageFields {
  const f = emptyTitlePageFields();
  Object.assign(f.known, known);
  f.other = other;
  return f;
}

/** Apply the computed edits and re-parse — the round trip is what
 *  actually matters, since several ways of emitting a title page parse
 *  as no title page at all. */
function roundTrip(source: string, f: TitlePageFields) {
  const script = parse(source, {});
  const edits = computeTitlePageEdits(script, f);
  const text = applyEdits(source, edits);
  return { text, script: parse(text, {}) };
}

describe("reading title page fields", () => {
  test("a document without a title page yields empty fields", () => {
    const f = titlePageFieldsOf(parse("FADE IN:\n\nAction.\n\n", {}));
    expect(f).toEqual(emptyTitlePageFields());
    expect(titlePageFieldsAreEmpty(f)).toBe(true);
  });

  test("known keys are read into their fields", () => {
    const f = titlePageFieldsOf(
      parse("Title: Big Fish\nAuthor: John August\n\nAction.\n\n", {}),
    );
    expect(f.known.Title).toBe("Big Fish");
    expect(f.known.Author).toBe("John August");
    expect(f.other).toEqual([]);
  });

  test("key matching is case insensitive and re-canonicalised", () => {
    const f = titlePageFieldsOf(
      parse("TITLE: X\ndraft DATE: 1/1/26\n\nAction.\n\n", {}),
    );
    expect(f.known.Title).toBe("X");
    expect(f.known["Draft date"]).toBe("1/1/26");
    expect(f.other).toEqual([]);
  });

  test("multi-line values are joined with newlines", () => {
    const f = titlePageFieldsOf(
      parse("Contact:\n   John August\n   555-0100\n\nAction.\n\n", {}),
    );
    expect(f.known.Contact).toBe("John August\n555-0100");
  });

  test("unknown keys are preserved in document order", () => {
    const f = titlePageFieldsOf(
      parse("Title: X\nCopyright: 2026\nRevision: Blue\n\nAction.\n\n", {}),
    );
    expect(f.known.Title).toBe("X");
    expect(f.other).toEqual([
      ["Copyright", "2026"],
      ["Revision", "Blue"],
    ]);
  });

  test("inline emphasis is kept as markup, not flattened", () => {
    const f = titlePageFieldsOf(parse("Title: *Star* Wars\n\nAction.\n\n", {}));
    expect(f.known.Title).toBe("*Star* Wars");
  });

  test("a value containing a colon survives", () => {
    const f = titlePageFieldsOf(
      parse("Title: Part 2: Revenge\n\nAction.\n\n", {}),
    );
    expect(f.known.Title).toBe("Part 2: Revenge");
  });
});

describe("rendering a title page block", () => {
  test("empty fields render as nothing at all", () => {
    expect(renderTitlePageBlock(emptyTitlePageFields())).toBe("");
  });

  test("blank fields are omitted rather than emitted empty", () => {
    // `Title:` with no value stops the whole block from parsing, so a
    // blank Credit must not be written out at all.
    const block = renderTitlePageBlock(fields({ Title: "X", Credit: "" }));
    expect(block).toBe("Title: X\n\n");
    expect(block).not.toContain("Credit");
  });

  test("the block ends with the blank line that terminates it", () => {
    expect(renderTitlePageBlock(fields({ Title: "X" }))).toMatch(/\n\n$/);
  });

  test("fields are written in conventional order regardless of input", () => {
    const block = renderTitlePageBlock(
      fields({ Contact: "c", Title: "t", Author: "a" }),
    );
    expect(block).toBe("Title: t\nAuthor: a\nContact: c\n\n");
  });

  test("multi-line values use 3-space continuation indents", () => {
    const block = renderTitlePageBlock(
      fields({ Contact: "John August\n555-0100" }),
    );
    expect(block).toBe("Contact:\n   John August\n   555-0100\n\n");
  });

  test("unknown keys are written after the known ones", () => {
    const block = renderTitlePageBlock(
      fields({ Title: "X" }, [["Copyright", "2026"]]),
    );
    expect(block).toBe("Title: X\nCopyright: 2026\n\n");
  });

  test("an unknown key with a blank value is dropped", () => {
    expect(
      renderTitlePageBlock(fields({ Title: "X" }, [["Copyright", "  "]])),
    ).toBe("Title: X\n\n");
  });
});

describe("computing title page edits", () => {
  test("creating one in a document that has none", () => {
    const { text, script } = roundTrip(
      "FADE IN:\n\nAction.\n\n",
      fields({ Title: "Big Fish", Author: "John August" }),
    );
    expect(text).toBe(
      "Title: Big Fish\nAuthor: John August\n\nFADE IN:\n\nAction.\n\n",
    );
    expect(script.titlePage?.keyValues.map((kv) => kv.key)).toEqual([
      "Title",
      "Author",
    ]);
    // The body must survive untouched.
    expect(script.script.length).toBeGreaterThan(0);
  });

  test("creating one in an empty document", () => {
    const { script } = roundTrip("", fields({ Title: "X" }));
    expect(script.titlePage?.keyValues).toHaveLength(1);
  });

  test("replacing an existing one leaves the body alone", () => {
    const source = "Title: Old\nAuthor: Nobody\n\nINT. HOUSE - DAY\n\nAction.\n\n";
    const { text, script } = roundTrip(source, fields({ Title: "New" }));
    expect(text).toBe("Title: New\n\nINT. HOUSE - DAY\n\nAction.\n\n");
    expect(script.titlePage?.keyValues).toHaveLength(1);
    expect(script.script.map((e) => e.kind)).toEqual(["scene", "action"]);
  });

  test("clearing every field removes the title page", () => {
    const source = "Title: Old\n\nINT. HOUSE - DAY\n\nAction.\n\n";
    const { text, script } = roundTrip(source, emptyTitlePageFields());
    expect(text).toBe("INT. HOUSE - DAY\n\nAction.\n\n");
    expect(script.titlePage).toBeNull();
  });

  test("an unchanged title page produces no edits", () => {
    const source = "Title: X\nAuthor: Y\n\nAction.\n\n";
    const script = parse(source, {});
    expect(computeTitlePageEdits(script, titlePageFieldsOf(script))).toEqual(
      [],
    );
  });

  test("no title page and nothing to write produces no edits", () => {
    const script = parse("Action.\n\n", {});
    expect(computeTitlePageEdits(script, emptyTitlePageFields())).toEqual([]);
  });

  test("a full round trip through parse/render is stable", () => {
    const source =
      "Title: Big Fish\nCredit: written by\nAuthor: John August\nSource: based on the novel\nDraft date: 1/18/2003\nContact:\n   John August\n   555-0100\nCopyright: 2003\n\nFADE IN:\n\n";
    const script = parse(source, {});
    const edits = computeTitlePageEdits(script, titlePageFieldsOf(script));
    // Re-rendering what we just read should be a no-op.
    expect(edits).toEqual([]);
  });

  test("editing preserves unknown keys the dialog never showed", () => {
    const source = "Title: Old\nCopyright: 2026\n\nAction.\n\n";
    const script = parse(source, {});
    const f = titlePageFieldsOf(script);
    f.known.Title = "New";
    const { script: after } = roundTrip(source, f);
    expect(after.titlePage?.keyValues.map((kv) => kv.key)).toEqual([
      "Title",
      "Copyright",
    ]);
  });

  test("values with emphasis survive a round trip", () => {
    const source = "Title: *Star* Wars\n\nAction.\n\n";
    const script = parse(source, {});
    expect(computeTitlePageEdits(script, titlePageFieldsOf(script))).toEqual(
      [],
    );
  });
});
