import { describe, expect, test } from "@jest/globals";
import { parse } from "../src/fountain/parser";
import { generateInstructions } from "../src/pdf/instruction_generator";
import type { PDFOptions } from "../src/pdf/options_dialog";
import type { TextInstruction } from "../src/pdf/types";

const OPTIONS: PDFOptions = {
  sceneHeadingBold: true,
  paperSize: "letter",
  hideNotes: true,
  hideSynopsis: true,
  hideMarginMarks: false,
};

/** The lower third of the title page as rendered *lines*, ordered top to
 *  bottom. The text wrapper emits one instruction per word, so a line is
 *  every instruction sharing a y, concatenated left to right. pdf-lib's
 *  y grows upward, so "top first" means descending y. */
function lowerBlock(
  source: string,
): { y: number; x: number; text: string }[] {
  const script = parse(source, {});
  const instructions = generateInstructions(script, OPTIONS);
  const texts = instructions.filter(
    (i): i is TextInstruction => i.type === "text" && i.y < 200,
  );

  const byLine = new Map<number, TextInstruction[]>();
  for (const i of texts) {
    const y = Math.round(i.y);
    const bucket = byLine.get(y);
    if (bucket) bucket.push(i);
    else byLine.set(y, [i]);
  }

  return Array.from(byLine.entries())
    .sort(([a], [b]) => b - a)
    .map(([y, parts]) => {
      const ordered = [...parts].sort((a, b) => a.x - b.x);
      return {
        y,
        x: Math.round(ordered[0].x),
        text: ordered.map((p) => p.data).join(""),
      };
    });
}

describe("title page side blocks", () => {
  test("a multi-line contact prints in the order it was written", () => {
    // The side blocks are laid out from the bottom of the page upward.
    // Emitting lines in reading order while stepping y upward printed
    // them bottom-to-top, so a two-line Contact came out inverted.
    const block = lowerBlock(
      "Title: T\nContact:\n   First Line\n   Second Line\n\nINT. X - DAY\n\nAction.\n",
    );
    expect(block.map((b) => b.text)).toEqual(["First Line", "Second Line"]);
    // Strictly descending y: first line really is higher on the page.
    expect(block[0].y).toBeGreaterThan(block[1].y);
  });

  test("draft date still prints on the right", () => {
    const block = lowerBlock(
      "Title: T\nDraft date: 1/1/2026\n\nINT. X - DAY\n\nAction.\n",
    );
    expect(block.map((b) => b.text)).toEqual(["1/1/2026"]);
    // Right-aligned: well past the left margin.
    expect(block[0].x).toBeGreaterThan(300);
  });

  test("contact still prints on the left, with no key label", () => {
    const block = lowerBlock(
      "Title: T\nContact: someone@example.com\n\nINT. X - DAY\n\nAction.\n",
    );
    expect(block.map((b) => b.text)).toEqual(["someone@example.com"]);
    expect(block[0].x).toBeLessThan(200);
  });

  test("keys with no placement rule are printed, not dropped", () => {
    // These render in the reading view but used to vanish from the PDF.
    const block = lowerBlock(
      "Title: T\nCopyright: 2026 Someone\nRevision: Blue\n\nINT. X - DAY\n\nAction.\n",
    );
    const text = block.map((b) => b.text);
    expect(text).toContain("Copyright: 2026 Someone");
    expect(text).toContain("Revision: Blue");
  });

  test("an unknown key is labelled and its value follows on the same line", () => {
    const block = lowerBlock(
      "Title: T\nCopyright: 2026\n\nINT. X - DAY\n\nAction.\n",
    );
    // The key label and its value share one line.
    expect(block.map((b) => b.text)).toEqual(["Copyright: 2026"]);
  });

  test("known and unknown keys keep document order, top to bottom", () => {
    const block = lowerBlock(
      "Title: T\nContact: CONTACT-VALUE\nCopyright: COPY-VALUE\n\nINT. X - DAY\n\nAction.\n",
    );
    const order = block.map((b) => b.text);
    const contactLine = order.findIndex((t) => t.includes("CONTACT-VALUE"));
    const copyrightLine = order.findIndex((t) => t.includes("COPY-VALUE"));
    expect(contactLine).toBeGreaterThanOrEqual(0);
    expect(copyrightLine).toBeGreaterThanOrEqual(0);
    // Contact was written first, so it prints above Copyright.
    expect(contactLine).toBeLessThan(copyrightLine);
  });

  test("a title page with no side keys emits no lower block", () => {
    expect(lowerBlock("Title: T\n\nINT. X - DAY\n\nAction.\n")).toEqual([]);
  });
});
