/**
 * @jest-environment jsdom
 */
import { describe, expect, test } from "@jest/globals";
import { fdxToFountain, fountainToFdx } from "../src/fountain/fdx";
import { parse } from "../src/fountain/parser";

const SCRIPT = [
  "Title: The Long Measure",
  "Author: A. Writer",
  "",
  "INT. KITCHEN - NIGHT",
  "",
  "She stands at the sink.",
  "",
  "MAYA",
  "(quietly)",
  "I can't do this any more.",
  "It has to stop.",
  "",
  "CUT TO:",
  "",
  "EXT. HIGHWAY - DAY",
  "",
  "Cars.",
  "",
].join("\n");

function toFdx(source: string): string {
  return fountainToFdx(parse(source, {}));
}

/** Paragraph type/text pairs, in document order. */
function paragraphs(fdx: string): [string, string][] {
  const doc = new DOMParser().parseFromString(fdx, "application/xml");
  const content = doc.getElementsByTagName("Content")[0];
  return Array.from(content.getElementsByTagName("Paragraph")).map((p) => [
    p.getAttribute("Type") ?? "",
    p.getElementsByTagName("Text")[0]?.textContent ?? "",
  ]);
}

describe("exporting to Final Draft", () => {
  test("produces a well-formed Final Draft document", () => {
    const fdx = toFdx(SCRIPT);
    const doc = new DOMParser().parseFromString(fdx, "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.documentElement.nodeName).toBe("FinalDraft");
    expect(doc.documentElement.getAttribute("DocumentType")).toBe("Script");
  });

  test("maps each element to its Final Draft paragraph type", () => {
    expect(paragraphs(toFdx(SCRIPT))).toEqual([
      ["Scene Heading", "INT. KITCHEN - NIGHT"],
      ["Action", "She stands at the sink."],
      ["Character", "MAYA"],
      ["Parenthetical", "(quietly)"],
      ["Dialogue", "I can't do this any more."],
      ["Dialogue", "It has to stop."],
      ["Transition", "CUT TO:"],
      ["Scene Heading", "EXT. HIGHWAY - DAY"],
      ["Action", "Cars."],
    ]);
  });

  test("the title page becomes a Final Draft title page", () => {
    const doc = new DOMParser().parseFromString(
      toFdx(SCRIPT),
      "application/xml",
    );
    const titlePage = doc.getElementsByTagName("TitlePage")[0];
    const texts = Array.from(titlePage.getElementsByTagName("Text")).map(
      (t) => t.textContent,
    );
    expect(texts).toEqual([
      "Title: The Long Measure",
      "Author: A. Writer",
    ]);
  });

  test("scene numbers are not part of the heading text", () => {
    expect(paragraphs(toFdx("INT. X - DAY #12A#\n\nAction.\n"))).toEqual([
      ["Scene Heading", "INT. X - DAY"],
      ["Action", "Action."],
    ]);
  });

  test("XML metacharacters in the script are escaped", () => {
    const fdx = toFdx("INT. X - DAY\n\nTom & Jerry <fight> \"loudly\".\n");
    expect(fdx).toContain("Tom &amp; Jerry &lt;fight&gt;");
    // And it still parses.
    const doc = new DOMParser().parseFromString(fdx, "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(paragraphs(fdx)[1][1]).toBe('Tom & Jerry <fight> "loudly".');
  });

  test("outline and annotation are deliberately not exported", () => {
    // Sections and synopses are the writer's own scaffolding, and a
    // Final Draft file is what gets sent to someone else.
    const types = paragraphs(
      toFdx("# Act One\n\n= A synopsis.\n\nINT. X - DAY\n\nAction.\n"),
    ).map(([type]) => type);
    expect(types).toEqual(["Scene Heading", "Action"]);
  });

  test("an empty script still produces a valid document", () => {
    const doc = new DOMParser().parseFromString(toFdx(""), "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.getElementsByTagName("Paragraph")).toHaveLength(0);
  });
});

describe("importing from Final Draft", () => {
  test("rejects input that is not Final Draft XML", () => {
    expect(fdxToFountain("not xml at all <<<")).toBeNull();
    expect(fdxToFountain("<html><body/></html>")).toBeNull();
  });

  test("round-trips a script through Final Draft and back", () => {
    const fountain = fdxToFountain(toFdx(SCRIPT));
    expect(fountain).not.toBeNull();
    const reparsed = parse(fountain as string, {});

    // The structure survives the trip.
    expect(reparsed.script.map((e) => e.kind)).toEqual([
      "scene",
      "action",
      "dialogue",
      "transition",
      "scene",
      "action",
    ]);
    // As does the title page.
    expect(reparsed.titlePage?.keyValues.map((kv) => kv.key)).toEqual([
      "Title",
      "Author",
    ]);
    // And the dialogue, parenthetical included.
    const dialogue = reparsed.script.find((e) => e.kind === "dialogue");
    if (dialogue?.kind !== "dialogue") throw new Error("no dialogue");
    expect(reparsed.charactersOf(dialogue)).toEqual(["MAYA"]);
    expect(
      dialogue.content.filter((c) => c.kind === "parenthetical"),
    ).toHaveLength(1);
  });

  test("forces a scene heading Fountain would not recognise", () => {
    const fdx = `<?xml version="1.0"?><FinalDraft DocumentType="Script"><Content>
      <Paragraph Type="Scene Heading"><Text>LATER THAT NIGHT</Text></Paragraph>
      </Content></FinalDraft>`;
    const fountain = fdxToFountain(fdx) as string;
    // Without the forcing dot this would come back as a character cue.
    expect(fountain.trim()).toBe(".LATER THAT NIGHT");
    expect(parse(fountain, {}).script[0].kind).toBe("scene");
  });

  test("forces action that would otherwise read as a character cue", () => {
    const fdx = `<?xml version="1.0"?><FinalDraft DocumentType="Script"><Content>
      <Paragraph Type="Action"><Text>SILENCE.</Text></Paragraph>
      </Content></FinalDraft>`;
    const fountain = fdxToFountain(fdx) as string;
    expect(fountain.trim()).toBe("!SILENCE.");
    expect(parse(fountain, {}).script[0].kind).toBe("action");
  });

  test("forces a character cue containing lowercase", () => {
    const fdx = `<?xml version="1.0"?><FinalDraft DocumentType="Script"><Content>
      <Paragraph Type="Character"><Text>McAvoy</Text></Paragraph>
      <Paragraph Type="Dialogue"><Text>Hello.</Text></Paragraph>
      </Content></FinalDraft>`;
    const fountain = fdxToFountain(fdx) as string;
    expect(fountain).toContain("@McAvoy");
    expect(parse(fountain, {}).script[0].kind).toBe("dialogue");
  });

  test("forces a transition that does not end in TO:", () => {
    const fdx = `<?xml version="1.0"?><FinalDraft DocumentType="Script"><Content>
      <Paragraph Type="Action"><Text>Something happens.</Text></Paragraph>
      <Paragraph Type="Transition"><Text>SMASH CUT</Text></Paragraph>
      </Content></FinalDraft>`;
    const fountain = fdxToFountain(fdx) as string;
    expect(fountain).toContain("> SMASH CUT");
    const kinds = parse(fountain, {}).script.map((e) => e.kind);
    expect(kinds).toContain("transition");
  });

  test("joins a styled run split across several Text nodes", () => {
    const fdx = `<?xml version="1.0"?><FinalDraft DocumentType="Script"><Content>
      <Paragraph Type="Action"><Text>She runs </Text><Text Style="Bold">fast</Text><Text> away.</Text></Paragraph>
      </Content></FinalDraft>`;
    expect((fdxToFountain(fdx) as string).trim()).toBe("She runs fast away.");
  });

  test("keeps a dialogue block together and separates other elements", () => {
    const fountain = fdxToFountain(toFdx(SCRIPT)) as string;
    // Character, parenthetical and dialogue lines are adjacent...
    expect(fountain).toContain("MAYA\n(quietly)\nI can't do this any more.");
    // ...while a scene heading is separated by a blank line.
    expect(fountain).toContain("INT. KITCHEN - NIGHT\n\nShe stands");
  });

  test("reads Key: value lines from a Final Draft title page", () => {
    const fdx = `<?xml version="1.0"?><FinalDraft DocumentType="Script">
      <Content><Paragraph Type="Action"><Text>Action.</Text></Paragraph></Content>
      <TitlePage><Content>
        <Paragraph Type="Action"><Text>Title: Big Fish</Text></Paragraph>
        <Paragraph Type="Action"><Text>some centred layout line</Text></Paragraph>
      </Content></TitlePage>
    </FinalDraft>`;
    const fountain = fdxToFountain(fdx) as string;
    const parsed = parse(fountain, {});
    expect(parsed.titlePage?.keyValues.map((kv) => kv.key)).toEqual(["Title"]);
    // Layout that isn't a Key: value line has no Fountain equivalent.
    expect(fountain).not.toContain("some centred layout line");
  });

  test("a document with no body content is still handled", () => {
    const fdx = `<?xml version="1.0"?><FinalDraft DocumentType="Script"></FinalDraft>`;
    expect(fdxToFountain(fdx)).toBe("\n");
  });
});
