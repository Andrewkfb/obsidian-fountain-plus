import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

/** End-to-end tests for reordering scenes from the outline sidebar. Drags
 *  are simulated by dispatching DragEvents with a shared DataTransfer —
 *  WebDriver can't drive HTML5 drag/drop through OS mouse events, but the
 *  synthetic events still run through the sidebar's real listeners. */

const FILE = "outline_reorder.fountain";

const ACTS = [
  "Title: Outline Test",
  "",
  "# Act I",
  "",
  "INT. SCENE A - DAY",
  "",
  "A content.",
  "",
  "INT. SCENE B - DAY",
  "",
  "B content.",
  "",
  "# Act II",
  "",
  "INT. SCENE C - DAY",
  "",
  "C content.",
  "",
  "# Act III",
  "",
].join("\n");

async function resetFile(): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, path: string, contents: string) => {
      const existing = app.vault.getAbstractFileByPath(path);
      if (existing) await app.vault.delete(existing);
      await app.vault.create(path, contents);
    },
    FILE,
    ACTS,
  );
  await obsidianPage.openFile(FILE);
  await browser.$(".screenplay").waitForExist({ timeout: 10_000 });
  // The outline lives in the right sidebar, which may start collapsed.
  await browser.executeObsidian(async ({ app }) => {
    const leaf = app.workspace.getLeavesOfType("fountain-sidebar")[0];
    if (leaf) await app.workspace.revealLeaf(leaf);
  });
  await browser.waitUntil(
    async () =>
      (await browser.$$(".screenplay-toc .toc-scene")).length === 3,
    { timeout: 5_000, timeoutMsg: "outline did not list three scenes" },
  );
}

async function readFile(): Promise<string> {
  return browser.executeObsidian(async ({ app }, path: string) => {
    const f = app.vault.getAbstractFileByPath(path) as any;
    return await app.vault.read(f);
  }, FILE);
}

/** Scene headings in file order, each prefixed by the section it sits in. */
async function outlineOrder(): Promise<string[]> {
  const text = await readFile();
  const result: string[] = [];
  let section = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("# ")) section = line.slice(2);
    else if (line.startsWith("INT. ")) result.push(`${section}: ${line}`);
  }
  return result;
}

async function waitForOrder(expected: string[]): Promise<void> {
  await browser.waitUntil(
    async () =>
      JSON.stringify(await outlineOrder()) === JSON.stringify(expected),
    {
      timeout: 5_000,
      timeoutMsg: `expected order ${JSON.stringify(expected)}, got ${JSON.stringify(await outlineOrder())}`,
    },
  );
}

/** Drag the outline row for `srcHeading` onto `target`: the lower half of
 *  another scene row (insert after) or a section heading (insert at the
 *  section's start). */
async function simulateDrop(
  srcHeading: string,
  target: { sceneAfter: string } | { section: string },
): Promise<void> {
  await browser.execute(
    (srcHeading: string, target: any) => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".screenplay-toc .toc-scene"),
      );
      const row = (h: string) =>
        rows.find((r) => r.querySelector(".scene-heading")?.textContent === h);
      const src = row(srcHeading);
      const dst =
        "sceneAfter" in target
          ? row(target.sceneAfter)
          : Array.from(
              document.querySelectorAll<HTMLElement>(
                ".screenplay-toc .toc-section-heading",
              ),
            ).find((h) => h.textContent === target.section);
      if (!src || !dst) throw new Error("outline row not found");

      const dt = new DataTransfer();
      src.dispatchEvent(
        new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }),
      );
      const rect = dst.getBoundingClientRect();
      const init = {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height * 0.9,
      };
      dst.dispatchEvent(new DragEvent("dragover", init));
      dst.dispatchEvent(new DragEvent("drop", init));
      src.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    },
    srcHeading,
    target,
  );
}

describe("Outline scene reordering", function () {
  beforeEach(async function () {
    await resetFile();
  });

  after(async function () {
    await obsidianPage.resetVault();
  });

  it("drags a scene below another scene in the same section", async function () {
    await simulateDrop("INT. SCENE A - DAY", { sceneAfter: "INT. SCENE B - DAY" });
    await waitForOrder([
      "Act I: INT. SCENE B - DAY",
      "Act I: INT. SCENE A - DAY",
      "Act II: INT. SCENE C - DAY",
    ]);
  });

  it("drops a scene on a section heading, including an empty section", async function () {
    await simulateDrop("INT. SCENE C - DAY", { section: "Act III" });
    await waitForOrder([
      "Act I: INT. SCENE A - DAY",
      "Act I: INT. SCENE B - DAY",
      "Act III: INT. SCENE C - DAY",
    ]);
    // The moved scene still parses as a scene, so the outline lists it
    // under its new section.
    await browser.waitUntil(async () => {
      const last = await browser.execute(() => {
        const sections = document.querySelectorAll(".screenplay-toc > section");
        const s = sections[sections.length - 1];
        return Array.from(s?.querySelectorAll(".scene-heading") ?? []).map(
          (h) => h.textContent,
        );
      });
      return JSON.stringify(last) === JSON.stringify(["INT. SCENE C - DAY"]);
    }, { timeout: 5_000, timeoutMsg: "outline did not show the moved scene under Act III" });
  });

  it("moves a scene with the ••• menu while the script is being edited", async function () {
    await browser.executeObsidian(({ app }, path: string) => {
      app.workspace.iterateAllLeaves((leaf) => {
        const v: any = leaf.view;
        if (v.getViewType?.() === "fountain" && v.file?.path === path) {
          v.switchToEditMode();
        }
      });
    }, FILE);
    await browser.$(".cm-editor").waitForExist({ timeout: 5_000 });

    // Obsidian may draw menus as native OS menus, which WebDriver can't
    // see; force the DOM menu for this test.
    await browser.executeObsidian(({ app }) => {
      (app.vault as any).setConfig("nativeMenus", false);
    });
    const rows = await browser.$$(".screenplay-toc .toc-scene");
    const rowB = rows[1];
    expect(await rowB.$(".scene-heading").getText()).toBe("INT. SCENE B - DAY");
    await rowB.moveTo();
    await rowB.$(".toc-more").click();
    const item = await browser.$("//div[contains(@class,'menu-item')][.//div[text()='Move down']]");
    await item.waitForExist({ timeout: 5_000 });
    await item.click();

    await waitForOrder([
      "Act I: INT. SCENE A - DAY",
      "Act II: INT. SCENE B - DAY",
      "Act II: INT. SCENE C - DAY",
    ]);
  });

  it("no longer offers the index card view", async function () {
    const exists = await browser.executeObsidian(
      ({ app }) =>
        !!(app as any).commands.commands["fountain-plus:toggle-index-cards-view"],
    );
    expect(exists).toBe(false);
  });
});
