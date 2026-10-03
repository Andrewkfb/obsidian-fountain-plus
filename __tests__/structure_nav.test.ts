import { describe, expect, test } from "@jest/globals";
import {
  applyEdits,
  computeMoveSceneEdits,
  findSceneAtOffset,
  isNoOpMove,
  resolveOutlineRef,
  sectionBlockRange,
  sectionMoveTargets,
  sceneMoveTargets,
  sectionDropPosition,
} from "../src/fountain";
import { parse } from "../src/fountain/parser";

const THREE_SCENES =
  "INT. HOUSE - DAY\n\nHome dialogue.\n\n" +
  "EXT. PARK - NIGHT\n\n= Park synopsis line.\n\nPark dialogue.\n\n" +
  "INT. CAR - DAY\n\nCar dialogue.\n\n";

describe("findSceneAtOffset", () => {
  test("returns the scene whose range contains the offset (inside body)", () => {
    const script = parse(THREE_SCENES, {});
    const offset = script.document.indexOf("Park dialogue.");
    const scene = findSceneAtOffset(script, offset);
    expect(scene?.scene?.heading).toBe("EXT. PARK - NIGHT");
  });

  test("returns the scene whose range contains the offset (on heading line)", () => {
    const script = parse(THREE_SCENES, {});
    const offset = script.document.indexOf("EXT. PARK - NIGHT");
    const scene = findSceneAtOffset(script, offset);
    expect(scene?.scene?.heading).toBe("EXT. PARK - NIGHT");
  });

  test("offset before the first scene returns the first scene", () => {
    const titlePage =
      "Title: Hello\n\n" +
      "INT. HOUSE - DAY\n\nHome dialogue.\n\n";
    const script = parse(titlePage, {});
    const scene = findSceneAtOffset(script, 0);
    expect(scene?.scene?.heading).toBe("INT. HOUSE - DAY");
  });

  test("offset on a section header before the first scene returns next scene", () => {
    const withSection =
      "# Act 1\n\nINT. HOUSE - DAY\n\nHome dialogue.\n\n";
    const script = parse(withSection, {});
    const scene = findSceneAtOffset(script, 2);
    expect(scene?.scene?.heading).toBe("INT. HOUSE - DAY");
  });

  test("returns null on an empty script with no scenes", () => {
    const script = parse("Just some action.\n\n", {});
    const scene = findSceneAtOffset(script, 0);
    expect(scene).toBeNull();
  });

  test("offset past the last scene returns the last scene", () => {
    const script = parse(THREE_SCENES, {});
    const scene = findSceneAtOffset(script, script.document.length);
    expect(scene?.scene?.heading).toBe("INT. CAR - DAY");
  });
});

const ACTS =
  "# Act I\n\nINT. A - DAY\n\nA.\n\nINT. B - DAY\n\nB.\n\n" +
  "# Act II\n\nINT. C - DAY\n\nC.\n\n" +
  "# Act III\n\n";

/** Outline as "section: scene, scene" lines, for compact assertions. */
function outline(doc: string): string[] {
  return parse(doc, {})
    .structure()
    .sections.map(
      (s) =>
        `${s.section ? doc.slice(s.section.range.start, s.section.range.end).trim() : "-"}: ` +
        s.content
          .filter((c) => c.scene)
          .map((c) => c.scene?.heading)
          .join(", "),
    );
}

function move(doc: string, heading: string, pos: (s: ReturnType<typeof parse>) => number | null): string {
  const script = parse(doc, {});
  const scene = findSceneAtOffset(script, doc.indexOf(heading));
  if (!scene) throw new Error("no scene");
  const p = pos(script);
  if (p === null) throw new Error("no target");
  return applyEdits(doc, computeMoveSceneEdits(script, scene.range, p));
}

describe("sceneMoveTargets", () => {
  test("moves within a section by swapping with the neighbour", () => {
    const doc = move(ACTS, "INT. B", (s) => sceneMoveTargets(s, ACTS.indexOf("INT. B")).up);
    expect(outline(doc)).toEqual(["# Act I: INT. B - DAY, INT. A - DAY", "# Act II: INT. C - DAY", "# Act III: "]);
  });

  test("moving down from the last scene enters the next section at its start", () => {
    const doc = move(ACTS, "INT. B", (s) => sceneMoveTargets(s, ACTS.indexOf("INT. B")).down);
    expect(outline(doc)).toEqual(["# Act I: INT. A - DAY", "# Act II: INT. B - DAY, INT. C - DAY", "# Act III: "]);
  });

  test("moving up from the first scene of a section ends the previous section", () => {
    const doc = move(ACTS, "INT. C", (s) => sceneMoveTargets(s, ACTS.indexOf("INT. C")).up);
    expect(outline(doc)).toEqual(["# Act I: INT. A - DAY, INT. B - DAY, INT. C - DAY", "# Act II: ", "# Act III: "]);
  });

  test("moving into an empty section lands after its heading as a real scene", () => {
    const doc = move(ACTS, "INT. C", (s) => sceneMoveTargets(s, ACTS.indexOf("INT. C")).down);
    expect(outline(doc)).toEqual(["# Act I: INT. A - DAY, INT. B - DAY", "# Act II: ", "# Act III: INT. C - DAY"]);
  });

  test("the outline's first and last scenes have nowhere further to go", () => {
    const script = parse(ACTS, {});
    expect(sceneMoveTargets(script, ACTS.indexOf("INT. A")).up).toBeNull();
    const plain = parse(THREE_SCENES, {});
    expect(sceneMoveTargets(plain, THREE_SCENES.indexOf("INT. CAR")).down).toBeNull();
  });

  test("works without any sections", () => {
    const doc = move(THREE_SCENES, "INT. CAR", (s) => sceneMoveTargets(s, THREE_SCENES.indexOf("INT. CAR")).up);
    expect(outline(doc)).toEqual(["-: INT. HOUSE - DAY, INT. CAR - DAY, EXT. PARK - NIGHT"]);
  });
});

describe("sectionDropPosition", () => {
  test("drops in front of a section's first scene", () => {
    const doc = move(ACTS, "INT. A", (s) => sectionDropPosition(s.structure().sections[1]));
    expect(outline(doc)).toEqual(["# Act I: INT. B - DAY", "# Act II: INT. A - DAY, INT. C - DAY", "# Act III: "]);
  });
});

describe("isNoOpMove", () => {
  test("positions at either edge of the scene are no-ops", () => {
    expect(isNoOpMove({ start: 10, end: 20 }, 10)).toBe(true);
    expect(isNoOpMove({ start: 10, end: 20 }, 20)).toBe(true);
    expect(isNoOpMove({ start: 10, end: 20 }, 21)).toBe(false);
  });
});

const NESTED =
  "Title: T\n\n" +
  "# Act I\n\nINT. A - DAY\n\nA.\n\n## Chase\n\nEXT. B - DAY\n\nB.\n\n" +
  "# Act II\n\nINT. C - DAY\n\nC.\n\n" +
  "# Act III\n\nINT. D - DAY\n\nD.\n";

function moveSection(doc: string, title: string, pos: (s: ReturnType<typeof parse>, start: number) => number | null): string {
  const script = parse(doc, {});
  const start = doc.indexOf(title);
  const block = sectionBlockRange(script, start);
  if (!block) throw new Error("no block");
  const p = pos(script, start);
  if (p === null) throw new Error("no target");
  return applyEdits(doc, computeMoveSceneEdits(script, block, p));
}

describe("sectionBlockRange", () => {
  test("a section's block includes its scenes and deeper subsections", () => {
    const script = parse(NESTED, {});
    const block = sectionBlockRange(script, NESTED.indexOf("# Act I"));
    expect(NESTED.slice(block?.start, block?.end)).toBe(
      "# Act I\n\nINT. A - DAY\n\nA.\n\n## Chase\n\nEXT. B - DAY\n\nB.\n\n",
    );
  });

  test("returns null when no heading starts there", () => {
    expect(sectionBlockRange(parse(NESTED, {}), 0)).toBeNull();
  });
});

describe("sectionMoveTargets", () => {
  test("moving down swaps with the next sibling, taking subsections along", () => {
    const doc = moveSection(NESTED, "# Act I", (s, st) => sectionMoveTargets(s, st).down);
    expect(outline(doc)).toEqual([
      "# Act II: INT. C - DAY",
      "# Act I: INT. A - DAY",
      "## Chase: EXT. B - DAY",
      "# Act III: INT. D - DAY",
    ]);
    expect(doc.startsWith("Title: T\n\n# Act II")).toBe(true);
  });

  test("moving up swaps with the previous sibling", () => {
    const doc = moveSection(NESTED, "# Act III", (s, st) => sectionMoveTargets(s, st).up);
    expect(doc.indexOf("# Act III")).toBeLessThan(doc.indexOf("# Act II\n"));
    expect(doc.indexOf("# Act I\n")).toBeLessThan(doc.indexOf("# Act III"));
  });

  test("a subsection only moves among siblings inside its parent", () => {
    const script = parse(NESTED, {});
    expect(sectionMoveTargets(script, NESTED.indexOf("## Chase"))).toEqual({ up: null, down: null });
  });

  test("the first and last sections have nowhere further to go", () => {
    const script = parse(NESTED, {});
    expect(sectionMoveTargets(script, NESTED.indexOf("# Act I")).up).toBeNull();
    expect(sectionMoveTargets(script, NESTED.indexOf("# Act III")).down).toBeNull();
  });
});

describe("resolveOutlineRef", () => {
  test("finds the scene in an edited script, where old offsets would be wrong", () => {
    const edited = ACTS.replace("A.\n", "A. Plus a sentence typed after the outline drew.\n");
    const script = parse(edited, {});
    const resolved = resolveOutlineRef(script, { kind: "scene", index: 1, label: "INT. B - DAY" });
    expect(edited.slice(resolved?.range.start, resolved?.range.end)).toBe("INT. B - DAY\n\nB.\n\n");
  });

  test("a section resolves to its whole block", () => {
    const script = parse(NESTED, {});
    const resolved = resolveOutlineRef(script, { kind: "section", index: 0, label: "Act I" });
    expect(NESTED.slice(resolved?.range.start, resolved?.range.end)).toBe(
      "# Act I\n\nINT. A - DAY\n\nA.\n\n## Chase\n\nEXT. B - DAY\n\nB.\n\n",
    );
    expect(resolved?.section?.section).toBeDefined();
  });

  test("refuses when the item at that position has a different label", () => {
    const script = parse(ACTS.replace("INT. B - DAY", "INT. RENAMED - DAY"), {});
    expect(resolveOutlineRef(script, { kind: "scene", index: 1, label: "INT. B - DAY" })).toBeNull();
    expect(resolveOutlineRef(script, { kind: "section", index: 5, label: "Act I" })).toBeNull();
  });
});

