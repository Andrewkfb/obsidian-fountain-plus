import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

/// Markdown notes show `[[foo.fountain]]` as `foo`, in both Reading view
/// and Live Preview, without touching the link source.
describe("Fountain links in markdown notes", function () {
  const NOTE = [
    "Plain [[test.fountain]] link.",
    "",
    "Heading [[test.fountain#INT. ROOM]] link.",
    "",
    "Aliased [[test.fountain|My draft]] link.",
    "",
    "Cursor parks here.",
    "",
  ].join("\n");

  before(async function () {
    await browser.executeObsidian(async ({ app }, note) => {
      const existing = app.vault.getAbstractFileByPath("links.md");
      if (existing) await app.vault.delete(existing);
      await app.vault.create("links.md", note);
    }, NOTE);
  });

  after(async function () {
    await obsidianPage.resetVault();
  });

  async function openNote(mode: "preview" | "source") {
    await browser.executeObsidian(async ({ app }, mode) => {
      const leaf = app.workspace.getLeaf(false);
      await leaf.setViewState({
        type: "markdown",
        state: { file: "links.md", mode, source: false },
        active: true,
      });
    }, mode);
  }

  it("hides the extension in Reading view", async function () {
    await openNote("preview");
    const links = browser.$$(".markdown-preview-view a.internal-link");
    await browser.waitUntil(async () => (await links.length) === 3, {
      timeout: 5_000,
    });
    const texts = await links.map((l) => l.getText());
    expect(texts).toEqual(["test", "test > INT. ROOM", "My draft"]);
  });

  it("hides the extension in Live Preview until the cursor enters the link", async function () {
    await openNote("source");
    // Park the cursor away from the links.
    await browser.executeObsidian(async ({ app }) => {
      const editor = app.workspace.activeEditor?.editor;
      editor?.setCursor({ line: 6, ch: 0 });
    });
    const lineText = async (n: number) =>
      browser.$$(".markdown-source-view .cm-line")[n].getText();

    await browser.waitUntil(
      async () => (await lineText(0)) === "Plain test link.",
      { timeout: 5_000, timeoutMsg: "extension was not hidden" },
    );
    // Live Preview shows heading links with `#`, unlike Reading view.
    expect(await lineText(2)).toBe("Heading test#INT. ROOM link.");
    expect(await lineText(4)).toBe("Aliased My draft link.");

    // Moving the cursor into the link reveals the full source.
    await browser.executeObsidian(async ({ app }) => {
      app.workspace.activeEditor?.editor?.setCursor({ line: 0, ch: 10 });
    });
    await browser.waitUntil(
      async () => (await lineText(0)).includes("test.fountain"),
      { timeout: 5_000, timeoutMsg: "link source was not revealed" },
    );
  });
});
