import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

/** End-to-end coverage for the commands added alongside Final Draft
 *  interop and script statistics. The conversion logic itself is unit
 *  tested; what these cover is the Obsidian half — commands being
 *  registered and available, files landing in the vault at a
 *  non-colliding path, and the statistics modal rendering real numbers. */

const SCRIPT = [
  "Title: Interop Test",
  "Author: Someone",
  "",
  "INT. KITCHEN - NIGHT",
  "",
  "She stands at the sink.",
  "",
  "MAYA",
  "(quietly)",
  "I can't do this any more.",
  "",
  "EXT. HIGHWAY - DAY",
  "",
  "Cars.",
  "",
].join("\n");

const FILE = "interop.fountain";

async function writeFile(path: string, contents: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, path: string, contents: string) => {
      const existing = app.vault.getAbstractFileByPath(path);
      if (existing) await app.vault.modify(existing as any, contents);
      else await app.vault.create(path, contents);
    },
    path,
    contents,
  );
}

async function deletePath(path: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, path: string) => {
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing) await app.vault.delete(existing);
  }, path);
}

async function readFile(path: string): Promise<string | null> {
  return browser.executeObsidian(async ({ app }, path: string) => {
    const f = app.vault.getAbstractFileByPath(path) as any;
    if (!f) return null;
    return await app.vault.read(f);
  }, path);
}

async function runCommand(id: string): Promise<void> {
  await browser.executeObsidian(({ app }, id: string) => {
    (app as any).commands.executeCommandById(id);
  }, id);
}

async function commandExists(id: string): Promise<boolean> {
  return browser.executeObsidian(({ app }, id: string) => {
    return Boolean((app as any).commands.findCommand(id));
  }, id);
}

async function waitForFile(path: string): Promise<string> {
  let content: string | null = null;
  await browser.waitUntil(
    async () => {
      content = await readFile(path);
      return content !== null;
    },
    { timeout: 5_000, timeoutMsg: `expected ${path} to be created` },
  );
  return content as unknown as string;
}

describe("Final Draft interop and statistics", function () {
  beforeEach(async function () {
    await writeFile(FILE, SCRIPT);
    await obsidianPage.openFile(FILE);
    await browser.$(".screenplay").waitForExist({ timeout: 10_000 });
  });

  afterEach(async function () {
    for (const sel of [".modal", ".prompt"]) {
      if (await browser.$(sel).isExisting()) await browser.keys(["Escape"]);
    }
    for (const p of [
      FILE,
      "interop.fdx",
      "interop 1.fdx",
      "imported.fdx",
      "imported.fountain",
    ]) {
      await deletePath(p);
    }
    await obsidianPage.resetVault();
  });

  it("registers every new command", async function () {
    for (const id of [
      "fountain:export-final-draft",
      "fountain:import-final-draft",
      "fountain:script-statistics",
      "fountain:toggle-edit-mode",
      "fountain:search-in-script",
      "fountain:move-selection-to-snippets",
      "fountain:copy-selection-to-snippets",
    ]) {
      expect(await commandExists(id)).toBe(true);
    }
  });

  it("exports the script as a Final Draft file beside it", async function () {
    await runCommand("fountain:export-final-draft");
    const fdx = await waitForFile("interop.fdx");

    expect(fdx).toContain("<FinalDraft");
    expect(fdx).toContain('<Paragraph Type="Scene Heading">');
    expect(fdx).toContain("INT. KITCHEN - NIGHT");
    expect(fdx).toContain('<Paragraph Type="Character">');
    expect(fdx).toContain("MAYA");
    expect(fdx).toContain("Title: Interop Test");
  });

  it("does not overwrite an existing .fdx", async function () {
    // An .fdx in the vault is as likely to be a collaborator's file as a
    // previous export, so the exporter picks a fresh name instead.
    await writeFile("interop.fdx", "PRECIOUS ORIGINAL");
    await runCommand("fountain:export-final-draft");

    await waitForFile("interop 1.fdx");
    expect(await readFile("interop.fdx")).toBe("PRECIOUS ORIGINAL");
  });

  it("imports a Final Draft file as a new fountain document", async function () {
    await writeFile(
      "imported.fdx",
      `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>
    <Paragraph Type="Scene Heading"><Text>INT. IMPORTED ROOM - DAY</Text></Paragraph>
    <Paragraph Type="Action"><Text>Something happens.</Text></Paragraph>
    <Paragraph Type="Character"><Text>DECKER</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>Imported line.</Text></Paragraph>
  </Content>
</FinalDraft>`,
    );

    await runCommand("fountain:import-final-draft");
    // A FuzzySuggestModal renders as `.prompt`, not `.modal`.
    await browser.$(".prompt").waitForExist({ timeout: 5_000 });
    await browser.$(".suggestion-item").waitForExist({ timeout: 5_000 });
    await browser.keys(["Enter"]);

    const fountain = await waitForFile("imported.fountain");
    expect(fountain).toContain("INT. IMPORTED ROOM - DAY");
    expect(fountain).toContain("DECKER");
    expect(fountain).toContain("Imported line.");
  });

  it("shows statistics with a real page count", async function () {
    await runCommand("fountain:script-statistics");
    await browser.$(".modal").waitForExist({ timeout: 5_000 });

    const text = await browser.$(".modal").getText();
    expect(text).toContain("Script statistics");
    expect(text).toContain("Pages");
    expect(text).toContain("Scenes");
    expect(text).toContain("MAYA");

    // Two scenes in the fixture, and the count column should hold it.
    const rows = await browser.execute(() => {
      const modal = document.querySelector(".modal");
      if (!modal) return null;
      const settings = Array.from(
        modal.querySelectorAll(".setting-item"),
      ).map((s) => ({
        name: s.querySelector(".setting-item-name")?.textContent?.trim() ?? "",
        value: s.querySelector(".fountain-stat-value")?.textContent ?? "",
      }));
      return settings.filter((s) => s.value.length > 0);
    });
    const scenes = rows?.find((r) => r.name === "Scenes");
    expect(scenes?.value).toBe("2");
  });

  it("persists PDF defaults chosen in the export dialog", async function () {
    await runCommand("fountain:generate-pdf");
    await browser.$(".modal").waitForExist({ timeout: 5_000 });

    // Flip paper size to A4, then confirm.
    await browser.execute(() => {
      const select = document.querySelector<HTMLSelectElement>(
        ".modal select",
      );
      if (!select) throw new Error("no paper size dropdown");
      select.value = "a4";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const buttons = await browser.$$(".modal button");
    for (const b of buttons) {
      if ((await b.getText()).trim() === "Generate PDF") {
        await b.click();
        break;
      }
    }

    await browser.waitUntil(
      async () =>
        (await browser.executeObsidian(async ({ app }) => {
          const plugin = (app as any).plugins.plugins.fountain;
          return plugin?.settings?.pdf?.paperSize ?? null;
        })) === "a4",
      { timeout: 5_000, timeoutMsg: "paper size was not persisted" },
    );

    await deletePath("interop.pdf");
  });
});
