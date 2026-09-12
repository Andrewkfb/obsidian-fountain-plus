import { describe, expect, test } from "@jest/globals";
import { parseFountain } from "../src/fountain/parse_safe";
import { parse } from "../src/fountain/parser";

/// The parser is supposed to be total — any string is a Fountain
/// document, with anything unrecognised falling through to action lines.
/// `parseFountain` is the boundary that guarantees it, so consumers need
/// no error branch. These tests cover both halves: that the grammar
/// really does accept the partial constructs writers type mid-keystroke,
/// and that the fallback holds if it ever doesn't.

describe("the grammar accepts partially-typed input", () => {
  // Every one of these is a document that exists for one keystroke while
  // the writer types something longer. A bare "#" used to throw, which
  // reached the CodeMirror StateField as an exception.
  const partial = [
    "#",
    "##",
    "###",
    "#\n",
    "# ",
    "Action.\n\n#",
    "MARY\nHi.\n\n#",
    "Title: X\n\n#",
    "INT. HOUSE - DAY\n\n#",
    "=",
    "==",
    "===",
    ">",
    "@",
    "!",
    "~",
    "[[",
    "/*",
    "*",
    "_",
    "",
    "\n",
    "\n\n",
  ];

  for (const src of partial) {
    test(`parses ${JSON.stringify(src)}`, () => {
      expect(() => parse(src, {})).not.toThrow();
    });
  }

  test("a bare # is a section, not an error", () => {
    const script = parseFountain("#");
    expect(script.script.map((e) => e.kind)).toEqual(["section"]);
  });

  test("typing a section heading one character at a time never throws", () => {
    const target = "Action.\n\n### Act One\n\nMore action.\n";
    for (let i = 0; i <= target.length; i++) {
      const prefix = target.slice(0, i);
      expect(() => parseFountain(prefix)).not.toThrow();
    }
  });
});

describe("parseFountain is total", () => {
  test("returns the same result as parse for valid input", () => {
    const src = "Title: X\n\nINT. HOUSE - DAY\n\nAction.\n\n";
    expect(JSON.stringify(parseFountain(src).script)).toEqual(
      JSON.stringify(parse(src, {}).script),
    );
  });

  test("the document is always preserved verbatim", () => {
    const src = "Some text\n\nMore text\n";
    expect(parseFountain(src).document).toBe(src);
  });

  test("falls back to action lines when the grammar rejects the input", () => {
    // Input the real grammar parses as [scene, action], so a passing
    // assertion below can only come from the fallback actually running.
    const text = "INT. HOUSE - DAY\n\nAction.";
    expect(parse(text, {}).script.map((e) => e.kind)).toEqual([
      "scene",
      "action",
    ]);

    const { script, loggedErrors } = fallbackScript(text);

    // The hole is reported rather than swallowed silently.
    expect(loggedErrors).toBe(1);

    expect(script.document).toBe(text);
    expect(script.script).toHaveLength(1);
    const [element] = script.script;
    expect(element.kind).toBe("action");
    if (element.kind !== "action") throw new Error("unreachable");

    // One Line per source line, with ranges that still index the document.
    expect(element.lines).toHaveLength(3);
    expect(sliceOf(text, element.lines[0])).toBe("INT. HOUSE - DAY");
    expect(sliceOf(text, element.lines[1])).toBe("");
    expect(sliceOf(text, element.lines[2])).toBe("Action.");
    // A blank source line carries no spans, matching the grammar.
    expect(element.lines[1].elements).toEqual([]);
    // The action covers the whole document.
    expect(element.range).toEqual({ start: 0, end: text.length });
  });
});

/** Force the fallback path by making the underlying parser throw, so the
 *  fallback is exercised without pinning a grammar hole that ought to be
 *  fixed. Returns how many times it logged, so the test can prove the
 *  catch ran rather than inferring it from the result's shape. */
function fallbackScript(text: string) {
  const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const parserModule =
    jest.requireActual<typeof import("../src/fountain/parser")>(
      "../src/fountain/parser",
    );
  const original = parserModule.parse;
  try {
    // biome-ignore lint/suspicious/noExplicitAny: test-only monkeypatch
    (parserModule as any).parse = () => {
      throw new Error("simulated grammar hole");
    };
    const script = parseFountain(text);
    return { script, loggedErrors: spy.mock.calls.length };
  } finally {
    // biome-ignore lint/suspicious/noExplicitAny: test-only monkeypatch
    (parserModule as any).parse = original;
    spy.mockRestore();
  }
}

function sliceOf(text: string, line: { range: { start: number; end: number } }) {
  return text.slice(line.range.start, line.range.end);
}
