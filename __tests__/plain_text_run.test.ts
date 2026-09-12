import { describe, expect, test } from "@jest/globals";
import { parse } from "../src/fountain/parser";
import type { FountainElement, Line } from "../src/fountain/types";

/// `StyledTextElement` has a fast path (`PlainTextRun`) that swallows a
/// whole run of ordinary characters as a single text node instead of one
/// node per character. Correctness of that rule is entirely about where
/// the run is required to *stop*: several elements (`Boneyard`,
/// `EndOfCenteredLine`) begin by consuming the blanks that precede their
/// marker, so those blanks belong to that element's range, not to the
/// text run. Getting it wrong shifts ranges by a character or two —
/// invisible in rendered output, but wrong for every range-keyed feature
/// (decorations, folding, index-card edits).
///
/// These tests pin the exact boundaries. If the fast path is widened,
/// they are what should catch the overshoot.

function linesOf(el: FountainElement): Line[] {
  if (el.kind !== "action") throw new Error(`expected action, got ${el.kind}`);
  return el.lines;
}

function firstLine(src: string): Line {
  const script = parse(src, {});
  return linesOf(script.script[0])[0];
}

describe("plain text run boundaries", () => {
  test("a run of ordinary prose is a single text node", () => {
    const line = firstLine("Some perfectly ordinary action prose.\n\n");
    expect(line.elements).toMatchObject([
      { kind: "text", range: { start: 0, end: 37 } },
    ]);
  });

  test("blanks before a boneyard belong to the boneyard", () => {
    // `Boneyard = OptionalBlanks "/*" ...` — the space at offset 6 is part
    // of the boneyard's range, so the text run must stop at offset 6.
    const line = firstLine("Before /* hidden */ after.\n\n");
    expect(line.elements).toMatchObject([
      { kind: "text", range: { start: 0, end: 6 } },
      { kind: "boneyard", range: { start: 6, end: 19 } },
      { kind: "text", range: { start: 19, end: 26 } },
    ]);
  });

  test("blanks before a centered line's closing marker are excluded", () => {
    // `EndOfCenteredLine = [ \t]* ("<" !. / "<\n")` — the trailing blanks
    // terminate the centered text rather than being part of it.
    const line = firstLine("> Hi   <\n\n");
    expect(line.centered).toBe(true);
    expect(line.elements).toMatchObject([
      { kind: "text", range: { start: 2, end: 4 } },
    ]);
  });

  test("a lone `<` mid-line stays ordinary text", () => {
    const line = firstLine("a < b and c <d\n\n");
    expect(line.centered).toBe(false);
    expect(line.elements).toMatchObject([
      { kind: "text", range: { start: 0, end: 14 } },
    ]);
  });

  test("a `/` that opens no boneyard stays ordinary text", () => {
    const line = firstLine("Either/or and 50/50.\n\n");
    expect(line.elements).toMatchObject([
      { kind: "text", range: { start: 0, end: 20 } },
    ]);
  });

  test("unpaired emphasis markers stay ordinary text", () => {
    const line = firstLine("A lone * star and snake_case here.\n\n");
    expect(line.elements).toMatchObject([
      { kind: "text", range: { start: 0, end: 34 } },
    ]);
  });

  test("a lone `[` stays ordinary text", () => {
    const line = firstLine("An array a[0] here.\n\n");
    expect(line.elements).toMatchObject([
      { kind: "text", range: { start: 0, end: 19 } },
    ]);
  });

  test("runs around styled spans keep their exact ranges", () => {
    const line = firstLine("plain **bold** plain\n\n");
    expect(line.elements).toMatchObject([
      { kind: "text", range: { start: 0, end: 6 } },
      { kind: "bold", range: { start: 6, end: 14 } },
      { kind: "text", range: { start: 14, end: 20 } },
    ]);
  });

  test("blanks before a note belong to the text run", () => {
    // `Note` has no leading-blank rule, so unlike Boneyard the space
    // before `[[` is part of the preceding text.
    const line = firstLine("Action [[todo: fix]] more.\n\n");
    expect(line.elements).toMatchObject([
      { kind: "text", range: { start: 0, end: 7 } },
      { kind: "note", range: { start: 7, end: 20 } },
      { kind: "text", range: { start: 20, end: 26 } },
    ]);
  });
});
