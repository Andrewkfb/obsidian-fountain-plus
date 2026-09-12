import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

/** Read a vault file's current on-disk contents. */
async function readFile(path: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, path: string) => {
    const f = app.vault.getAbstractFileByPath(path) as any;
    return await app.vault.read(f);
  }, path);
}

async function writeFile(path: string, contents: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, path: string, contents: string) => {
      const f = app.vault.getAbstractFileByPath(path) as any;
      await app.vault.modify(f, contents);
    },
    path,
    contents,
  );
}

async function runEditTitlePage(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    (app as any).commands.executeCommandById("fountain:edit-title-page");
  });
  await browser.$(".modal").waitForExist({ timeout: 5_000 });
}

/** The dialog renders one Setting per field, in `TITLE_PAGE_KEYS` order.
 *  Look the input up by its setting's name so the test doesn't depend on
 *  that ordering. */
async function fieldInput(name: string) {
  const items = await browser.$$(".modal .setting-item");
  for (const item of items) {
    const label = await item.$(".setting-item-name");
    if ((await label.getText()).trim() === name) {
      const input = await item.$("input, textarea");
      if (await input.isExisting()) return input;
    }
  }
  throw new Error(`no title page field named ${name}`);
}

async function setField(name: string, value: string): Promise<void> {
  const input = await fieldInput(name);
  await input.setValue(value);
}

/** Emptying a field has to go through the keyboard: WebDriver's own
 *  clear does not dispatch the `input` event that Obsidian's
 *  TextComponent listens on, so `setValue("")` would leave the
 *  component's value — and therefore the document — untouched. */
async function clearField(name: string): Promise<void> {
  const input = await fieldInput(name);
  await input.click();
  await browser.keys(["Meta", "a"]);
  await browser.keys(["Delete"]);
}

/** Text of the *visible* screenplay element. The sidebar renders its own
 *  hidden `.screenplay` nodes, so a bare selector can pick the wrong one
 *  and `getText()` only reports visible text. */
async function visibleScreenplayText(): Promise<string> {
  return browser.execute(() => {
    const els = Array.from(document.querySelectorAll(".screenplay"));
    const visible = els.find(
      (e) =>
        !!((e as HTMLElement).offsetWidth || (e as HTMLElement).offsetHeight),
    );
    return visible ? visible.textContent || "" : "";
  });
}

async function clickButton(text: string): Promise<void> {
  const buttons = await browser.$$(".modal button");
  for (const b of buttons) {
    if ((await b.getText()).trim() === text) {
      await b.click();
      return;
    }
  }
  throw new Error(`no button labelled ${text}`);
}

/** The write goes through the async edit pipeline, so poll rather than
 *  assuming it has landed by the time the modal closes. */
async function waitForContent(
  path: string,
  predicate: (text: string) => boolean,
): Promise<string> {
  let latest = "";
  await browser.waitUntil(
    async () => {
      latest = await readFile(path);
      return predicate(latest);
    },
    { timeout: 5_000, timeoutMsg: `file never matched; last saw:\n${latest}` },
  );
  return latest;
}

describe("Title page", function () {
  beforeEach(async function () {
    await obsidianPage.openFile("test.fountain");
    await browser.$(".screenplay").waitForExist({ timeout: 10_000 });
  });

  afterEach(async function () {
    // Close the modal if a failing test left it open.
    if (await browser.$(".modal").isExisting()) {
      await browser.keys(["Escape"]);
    }
    await obsidianPage.resetVault();
  });

  it("prefills the dialog from the document's existing title page", async function () {
    await runEditTitlePage();

    await expect(await fieldInput("Title")).toHaveValue("Test Script");
    await expect(await fieldInput("Author")).toHaveValue("Test");

    await clickButton("Cancel");
  });

  it("cancelling leaves the document untouched", async function () {
    const before = await readFile("test.fountain");

    await runEditTitlePage();
    await setField("Title", "Should Not Persist");
    await clickButton("Cancel");

    await browser.pause(300);
    expect(await readFile("test.fountain")).toBe(before);
  });

  it("saving an edited title updates the document", async function () {
    await runEditTitlePage();
    await setField("Title", "Renamed Script");
    await clickButton("Save");

    const text = await waitForContent("test.fountain", (t) =>
      t.startsWith("Title: Renamed Script"),
    );
    // The body must survive the replacement.
    expect(text).toContain("INT. OFFICE - DAY");
    expect(text).toContain("Hello World");
  });

  it("adds fields that were not there before", async function () {
    await runEditTitlePage();
    await setField("Credit", "written by");
    await setField("Draft date", "1/1/2026");
    await clickButton("Save");

    const text = await waitForContent("test.fountain", (t) =>
      t.includes("Credit: written by"),
    );
    expect(text).toContain("Draft date: 1/1/2026");
    // Conventional ordering, and the block still terminates properly.
    expect(text.indexOf("Credit:")).toBeLessThan(text.indexOf("Author:"));
    expect(text).toMatch(/Draft date: 1\/1\/2026\n\n/);
  });

  it("creates a title page in a document that has none", async function () {
    await writeFile("test.fountain", "INT. OFFICE - DAY\n\nHello World\n\n");
    await browser.pause(300);

    await runEditTitlePage();
    await expect(await fieldInput("Title")).toHaveValue("");
    await setField("Title", "Brand New");
    await setField("Author", "Someone");
    await clickButton("Save");

    const text = await waitForContent("test.fountain", (t) =>
      t.startsWith("Title: Brand New"),
    );
    expect(text).toBe(
      "Title: Brand New\nAuthor: Someone\n\nINT. OFFICE - DAY\n\nHello World\n\n",
    );
  });

  it("clearing every field removes the title page", async function () {
    await runEditTitlePage();
    await clearField("Title");
    await clearField("Author");
    await clickButton("Save");

    const text = await waitForContent(
      "test.fountain",
      (t) => !t.startsWith("Title:"),
    );
    expect(text.startsWith("INT. OFFICE - DAY")).toBe(true);
  });

  it("the readonly view reflects the new title without a reload", async function () {
    await runEditTitlePage();
    await setField("Title", "Live Updated");
    await clickButton("Save");

    await browser.waitUntil(
      async () => (await visibleScreenplayText()).includes("Live Updated"),
      { timeout: 5_000, timeoutMsg: "readonly view never re-rendered" },
    );
  });

  it("multi-line contact details round-trip as indented lines", async function () {
    await runEditTitlePage();
    await setField("Contact", "John August\n555-0100");
    await clickButton("Save");

    const text = await waitForContent("test.fountain", (t) =>
      t.includes("Contact:"),
    );
    expect(text).toContain("Contact:\n   John August\n   555-0100\n");
  });
});
