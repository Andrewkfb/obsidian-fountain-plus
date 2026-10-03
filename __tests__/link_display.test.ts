import { describe, expect, test } from "@jest/globals";
import {
  fountainExtensionRange,
  stripFountainExtension,
} from "../src/link_display";

describe("fountainExtensionRange", () => {
  test("finds the extension at the end of the target", () => {
    expect(fountainExtensionRange("Script.fountain")).toEqual({
      start: 6,
      end: 15,
    });
  });

  test("ignores the heading after the path", () => {
    expect(fountainExtensionRange("Script.fountain#INT. ROOM")).toEqual({
      start: 6,
      end: 15,
    });
  });

  test("ignores the alias after the path", () => {
    expect(fountainExtensionRange("Script.fountain|Draft")).toEqual({
      start: 6,
      end: 15,
    });
  });

  test("matches case-insensitively", () => {
    expect(fountainExtensionRange("Script.Fountain")).not.toBeNull();
  });

  test("returns null for other files", () => {
    expect(fountainExtensionRange("Notes")).toBeNull();
    expect(fountainExtensionRange("Script.fountain.md")).toBeNull();
    expect(fountainExtensionRange("Notes#Script.fountain")).toBeNull();
  });
});

describe("stripFountainExtension", () => {
  test("strips the extension from an unaliased link", () => {
    expect(stripFountainExtension("Script.fountain", "Script.fountain")).toBe(
      "Script",
    );
  });

  test("keeps the folder path", () => {
    expect(
      stripFountainExtension(
        "Drafts/Script.fountain",
        "Drafts/Script.fountain",
      ),
    ).toBe("Drafts/Script");
  });

  test("keeps the heading", () => {
    expect(
      stripFountainExtension(
        "Script.fountain > INT. ROOM",
        "Script.fountain#INT. ROOM",
      ),
    ).toBe("Script > INT. ROOM");
  });

  test("leaves aliased links alone", () => {
    expect(stripFountainExtension("My draft", "Script.fountain")).toBe(
      "My draft",
    );
  });

  test("leaves links to other files alone", () => {
    expect(stripFountainExtension("Notes", "Notes")).toBe("Notes");
  });
});
