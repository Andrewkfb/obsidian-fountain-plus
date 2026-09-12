import { describe, expect, test } from "@jest/globals";
import { EditorState } from "@codemirror/state";
import type { CompletionContext } from "@codemirror/autocomplete";
import { parse } from "../src/fountain/parser";
import {
  createSceneCompletionSource,
  knownLocations,
} from "../src/codemirror/scene_completion";

const SCRIPT = [
  "INT. MAYA'S KITCHEN - NIGHT",
  "",
  "She stands at the sink.",
  "",
  "EXT. HIGHWAY - DAY",
  "",
  "Cars.",
  "",
  "INT. PRECINCT - DAY #12#",
  "",
  "Desks.",
  "",
  "INT. MAYA'S KITCHEN - NIGHT",
  "",
  "Again.",
  "",
].join("\n");

/** Drive the completion source against a document whose cursor sits at
 *  the end of `line`, appended to `SCRIPT`. Returns the labels offered. */
function complete(line: string, script = SCRIPT) {
  const doc = `${script}\n${line}`;
  const state = EditorState.create({ doc });
  const pos = doc.length;
  const context = {
    state,
    pos,
    explicit: false,
    matchBefore(expr: RegExp) {
      const l = state.doc.lineAt(pos);
      const text = l.text.slice(0, pos - l.from);
      const m = text.match(expr);
      if (!m) return null;
      return { from: pos - m[0].length, to: pos, text: m[0] };
    },
  } as unknown as CompletionContext;

  const source = createSceneCompletionSource(() => parse(script, {}));
  const result = source(context);
  if (result === null || result instanceof Promise) return null;
  return {
    from: result.from,
    labels: result.options.map((o) => o.label),
    applies: result.options.map((o) =>
      typeof o.apply === "string" ? o.apply : o.label,
    ),
  };
}

describe("known locations", () => {
  test("collects distinct locations from scene headings", () => {
    expect(knownLocations(parse(SCRIPT, {}))).toEqual(
      expect.arrayContaining([
        "MAYA'S KITCHEN - NIGHT",
        "HIGHWAY - DAY",
        "PRECINCT - DAY",
      ]),
    );
  });

  test("scene numbers are not part of the location", () => {
    // `#12#` is a scene number, not a piece of the location name.
    expect(knownLocations(parse(SCRIPT, {}))).toContain("PRECINCT - DAY");
    for (const location of knownLocations(parse(SCRIPT, {}))) {
      expect(location).not.toContain("#");
    }
  });

  test("a repeated location appears once", () => {
    const locations = knownLocations(parse(SCRIPT, {}));
    const kitchens = locations.filter((l) => l === "MAYA'S KITCHEN - NIGHT");
    expect(kitchens).toHaveLength(1);
  });

  test("most recently used comes first", () => {
    // The kitchen is used again at the end, so it should outrank the
    // highway the writer left two scenes ago.
    const locations = knownLocations(parse(SCRIPT, {}));
    expect(locations[0]).toBe("MAYA'S KITCHEN - NIGHT");
  });

  test("a script with no scenes has no locations", () => {
    expect(knownLocations(parse("Just action.\n", {}))).toEqual([]);
  });
});

describe("slugline completion", () => {
  test("offers prefixes once typing has started", () => {
    const result = complete("IN");
    expect(result?.labels).toEqual(["INT.", "INT./EXT."]);
    // Applying leaves the trailing space, ready for the location.
    expect(result?.applies).toEqual(["INT. ", "INT./EXT. "]);
  });

  test("narrows as more is typed", () => {
    expect(complete("EXT")?.labels).toEqual(["EXT.", "EXT./INT."]);
  });

  test("stays quiet on an empty line", () => {
    // Popping the list open on every blank line is noise, not help.
    expect(complete("")).toBeNull();
  });

  test("a forced-heading dot opens the full list", () => {
    expect(complete(".")?.labels).toEqual([
      "INT.",
      "EXT.",
      "INT./EXT.",
      "EXT./INT.",
      "I/E.",
      "EST.",
    ]);
  });

  test("a forced heading replaces after the dot, keeping the marker", () => {
    const doc = `${SCRIPT}\n.IN`;
    const result = complete(".IN");
    expect(result?.labels).toEqual(["INT.", "INT./EXT."]);
    // `from` sits just after the `.` so the forcing marker survives.
    expect(result?.from).toBe(doc.length - 2);
  });

  test("ignores lowercase prose", () => {
    expect(complete("interior of a house")).toBeNull();
  });

  test("ignores a capitalised word that is not a slugline", () => {
    expect(complete("MAYA")).toBeNull();
  });
});

describe("location completion", () => {
  test("offers known locations once the slugline is complete", () => {
    const result = complete("INT. ");
    expect(result?.labels).toEqual(
      expect.arrayContaining(["MAYA'S KITCHEN - NIGHT", "PRECINCT - DAY"]),
    );
  });

  test("filters locations by what has been typed", () => {
    expect(complete("INT. MAYA")?.labels).toEqual(["MAYA'S KITCHEN - NIGHT"]);
  });

  test("matching is case insensitive", () => {
    expect(complete("INT. maya")?.labels).toEqual(["MAYA'S KITCHEN - NIGHT"]);
  });

  test("replaces only the location, not the slugline", () => {
    const doc = `${SCRIPT}\nINT. MAYA`;
    const result = complete("INT. MAYA");
    expect(result?.from).toBe(doc.length - "MAYA".length);
  });

  test("offers locations regardless of which prefix was used", () => {
    // A location first seen as INT. is still a sensible EXT. completion.
    expect(complete("EXT. MAYA")?.labels).toEqual(["MAYA'S KITCHEN - NIGHT"]);
  });

  test("returns nothing when no location matches", () => {
    expect(complete("INT. ZZZZ")).toBeNull();
  });

  test("returns nothing when the script has no scenes", () => {
    expect(complete("INT. ", "Just action.\n")).toBeNull();
  });
});
