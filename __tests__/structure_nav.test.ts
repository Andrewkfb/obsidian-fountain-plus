import { describe, expect, test } from "@jest/globals";
import {
  applyEdits,
  computeMoveSceneEdits,
  findSceneAtOffset,
  isNoOpSceneMove,
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

describe("isNoOpSceneMove", () => {
  test("positions at either edge of the scene are no-ops", () => {
    expect(isNoOpSceneMove({ start: 10, end: 20 }, 10)).toBe(true);
    expect(isNoOpSceneMove({ start: 10, end: 20 }, 20)).toBe(true);
    expect(isNoOpSceneMove({ start: 10, end: 20 }, 21)).toBe(false);
  });
});
