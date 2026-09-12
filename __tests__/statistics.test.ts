import { describe, expect, test } from "@jest/globals";
import { parse } from "../src/fountain/parser";
import { computeStatistics } from "../src/fountain/statistics";

function stats(source: string, pages: number | null = null) {
  return computeStatistics(parse(source, {}), pages);
}

const SCRIPT = [
  "Title: Test",
  "",
  "# Act One",
  "",
  "INT. KITCHEN - NIGHT",
  "",
  "She stands at the sink. Water runs.",
  "",
  "A second paragraph of action here.",
  "",
  "MAYA",
  "(quietly)",
  "I can't do this any more.",
  "It has to stop.",
  "",
  "DECKER",
  "Then stop.",
  "",
  "EXT. HIGHWAY - DAY",
  "",
  "MAYA",
  "Drive.",
  "",
].join("\n");

describe("counting structure", () => {
  test("counts scenes and sections", () => {
    const s = stats(SCRIPT);
    expect(s.scenes).toBe(2);
    expect(s.sections).toBe(1);
  });

  test("deep section headings are not structure", () => {
    // `####+` headings are scene-internal subsections, matching how
    // `structure()` treats them.
    const s = stats("# Act\n\n#### Beat\n\nINT. X - DAY\n\nAction.\n");
    expect(s.sections).toBe(1);
  });

  test("counts action paragraphs, not action elements", () => {
    // The parser merges consecutive action into a single element, so a
    // naive count would report 1 for the two paragraphs in SCRIPT.
    expect(stats(SCRIPT).actionParagraphs).toBe(2);
  });

  test("counts dialogue blocks", () => {
    expect(stats(SCRIPT).dialogueBlocks).toBe(3);
  });

  test("an empty script counts nothing", () => {
    const s = stats("");
    expect(s).toMatchObject({
      scenes: 0,
      sections: 0,
      actionParagraphs: 0,
      dialogueBlocks: 0,
      totalWords: 0,
      characters: [],
    });
  });
});

describe("per-character statistics", () => {
  test("counts speeches, lines and words per character", () => {
    const maya = stats(SCRIPT).characters.find((c) => c.name === "MAYA");
    expect(maya).toEqual({
      name: "MAYA",
      speeches: 2,
      // "I can't do this any more." + "It has to stop." + "Drive."
      lines: 3,
      words: 6 + 4 + 1,
    });
  });

  test("parentheticals are not counted as dialogue", () => {
    // Identical speeches, one with a parenthetical. A parenthetical is a
    // performance note, not words anybody says, so the counts must match.
    const withParenthetical = stats(
      "INT. X - DAY\n\nMAYA\n(quietly)\nI can't do this.\n\n",
    ).characters[0];
    const without = stats(
      "INT. X - DAY\n\nMAYA\nI can't do this.\n\n",
    ).characters[0];
    expect(withParenthetical).toEqual(without);
    expect(withParenthetical.lines).toBe(1);
  });

  test("busiest character comes first", () => {
    expect(stats(SCRIPT).characters[0].name).toBe("MAYA");
  });

  test("a dual-character cue credits both speakers", () => {
    // `MARY & BOB` is this plugin's extension for a shared cue.
    const s = stats("INT. X - DAY\n\nMARY & BOB\nWe agree.\n\n");
    expect(s.characters.map((c) => c.name).sort()).toEqual(["BOB", "MARY"]);
    for (const character of s.characters) {
      expect(character.speeches).toBe(1);
      expect(character.words).toBe(2);
    }
  });

  test("a script with no dialogue has no characters", () => {
    expect(stats("INT. X - DAY\n\nJust action.\n").characters).toEqual([]);
  });
});

describe("word counts", () => {
  test("total words spans action and dialogue", () => {
    const s = stats("INT. X - DAY\n\nTwo words.\n\nMAYA\nThree more words.\n\n");
    // "Two words." = 2, "Three more words." = 3
    expect(s.totalWords).toBe(5);
  });

  test("blank lines contribute nothing", () => {
    expect(stats("\n\n\n\n").totalWords).toBe(0);
  });
});

describe("page count", () => {
  test("is reported as given", () => {
    expect(stats(SCRIPT, 42).pages).toBe(42);
  });

  test("is null when unknown", () => {
    expect(stats(SCRIPT, null).pages).toBeNull();
  });
});
