import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

/** End-to-end tests for reordering scenes and sections from the outline
 *  sidebar. Drags run through Chromium's real drag-and-drop path via the
 *  DevTools `Input.setInterceptDrags` / `Input.dispatchDragEvent` commands
 *  (driven through Electron's debugger), so they exercise the browser's
 *  native drag handling and any global handlers Obsidian installs — not
 *  just our listeners, as synthetic DragEvents would. */

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

/** Scene headings and section titles in file order. */
async function sectionOrder(): Promise<string[]> {
  const text = await readFile();
  return text
    .split("\n")
    .filter((l) => l.startsWith("# "))
    .map((l) => l.slice(2));
}

type Target =
  | { scene: string; half: "top" | "bottom" }
  | { section: string; half: "top" | "bottom" };

/** Really drag (press, move, drop) the outline row for `src` onto `dst`.
 *  `src` names a scene heading or, with `section:`, a section title. */
async function nativeDrag(src: Target, dst: Target): Promise<void> {
  const point = async (t: Target) =>
    browser.execute((t: any) => {
      const el =
        "scene" in t
          ? Array.from(
              document.querySelectorAll<HTMLElement>(".screenplay-toc .toc-scene"),
            ).find((r) => r.querySelector(".scene-heading")?.textContent === t.scene)
          : Array.from(
              document.querySelectorAll<HTMLElement>(
                ".screenplay-toc .toc-section-heading",
              ),
            ).find((r) => r.querySelector(".section")?.textContent === t.section);
      if (!el) throw new Error(`outline row not found: ${JSON.stringify(t)}`);
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.left + 20),
        y: Math.round(t.half === "top" ? r.top + 3 : r.bottom - 3),
      };
    }, t);
  const from = await point(src);
  const to = await point(dst);
  const ok = await browser.execute(
    async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const req = (window as any).require;
      const remote = req("electron").remote ?? req("@electron/remote");
      const dbg = remote.getCurrentWebContents().debugger;
      if (!dbg.isAttached()) dbg.attach("1.3");
      let data: any = null;
      const onMessage = (_e: unknown, method: string, params: any) => {
        if (method === "Input.dragIntercepted") data = params.data;
      };
      dbg.on("message", onMessage);
      const send = (m: string, p: object) => dbg.sendCommand(m, p);
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const mouse = { button: "left", clickCount: 1 };
      try {
        await send("Input.setInterceptDrags", { enabled: true });
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from });
        await send("Input.dispatchMouseEvent", { type: "mousePressed", ...from, ...mouse, buttons: 1 });
        await sleep(100);
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + 10, y: from.y + 15, ...mouse, buttons: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...to, ...mouse, buttons: 1 });
        await sleep(200);
        if (data) {
          for (const type of ["dragEnter", "dragOver", "dragOver"]) {
            await send("Input.dispatchDragEvent", { type, ...to, data });
            await sleep(60);
          }
          await send("Input.dispatchDragEvent", { type: "drop", ...to, data });
        }
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, ...mouse, buttons: 0 });
        return !!data;
      } finally {
        await send("Input.setInterceptDrags", { enabled: false });
        dbg.removeListener("message", onMessage);
        dbg.detach();
      }
    },
    from,
    to,
  );
  if (!ok) throw new Error("the browser did not start a drag");
}

/** Open the ••• menu on an outline row and choose an item. Obsidian may
 *  draw native OS menus, which WebDriver can't see, so force DOM menus. */
async function chooseFromMoveMenu(row: Target, item: string): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    (app.vault as any).setConfig("nativeMenus", false);
  });
  const selector =
    "scene" in row
      ? `//div[contains(@class,'toc-scene')][.//div[contains(@class,'scene-heading') and text()='${row.scene}']]`
      : `//div[contains(@class,'toc-section-heading')][.//h3[text()='${row.section}']]`;
  const el = await browser.$(selector);
  await el.moveTo();
  await el.$(".toc-more").click();
  const entry = await browser.$(
    `//div[contains(@class,'menu-item')][.//div[text()='${item}']]`,
  );
  await entry.waitForExist({ timeout: 5_000 });
  await entry.click();
}

describe("Outline reordering", function () {
  beforeEach(async function () {
    await resetFile();
  });

  after(async function () {
    await obsidianPage.resetVault();
  });

  it("drags a scene below another scene in the same section", async function () {
    await nativeDrag(
      { scene: "INT. SCENE A - DAY", half: "top" },
      { scene: "INT. SCENE B - DAY", half: "bottom" },
    );
    await waitForOrder([
      "Act I: INT. SCENE B - DAY",
      "Act I: INT. SCENE A - DAY",
      "Act II: INT. SCENE C - DAY",
    ]);
  });

  it("drops a scene on a section heading, including an empty section", async function () {
    await nativeDrag(
      { scene: "INT. SCENE C - DAY", half: "top" },
      { section: "Act III", half: "bottom" },
    );
    await waitForOrder([
      "Act I: INT. SCENE A - DAY",
      "Act I: INT. SCENE B - DAY",
      "Act III: INT. SCENE C - DAY",
    ]);
    // The moved scene still parses as a scene, so the outline lists it
    // under its new section.
    await browser.waitUntil(
      async () => {
        const last = await browser.execute(() => {
          const sections = document.querySelectorAll(".screenplay-toc > section");
          const s = sections[sections.length - 1];
          return Array.from(s?.querySelectorAll(".scene-heading") ?? []).map(
            (h) => h.textContent,
          );
        });
        return JSON.stringify(last) === JSON.stringify(["INT. SCENE C - DAY"]);
      },
      { timeout: 5_000, timeoutMsg: "outline did not show the moved scene under Act III" },
    );
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
    await chooseFromMoveMenu({ scene: "INT. SCENE B - DAY", half: "top" }, "Move down");
    await waitForOrder([
      "Act I: INT. SCENE A - DAY",
      "Act II: INT. SCENE B - DAY",
      "Act II: INT. SCENE C - DAY",
    ]);
  });

  it("moves the right text when the script was edited after the outline drew", async function () {
    await browser.executeObsidian(({ app }, path: string) => {
      app.workspace.iterateAllLeaves((leaf) => {
        const v: any = leaf.view;
        if (v.getViewType?.() !== "fountain" || v.file?.path !== path) return;
        v.switchToEditMode();
        // Type at the start of the document body, shifting every offset
        // the outline drew with. The outline only redraws after autosave.
        const at = v.getScript().document.indexOf("A content.");
        v.state.dispatchChanges({ from: at, to: at, insert: "Freshly typed. " });
      });
    }, FILE);
    await chooseFromMoveMenu({ scene: "INT. SCENE B - DAY", half: "top" }, "Move down");
    await waitForOrder([
      "Act I: INT. SCENE A - DAY",
      "Act II: INT. SCENE B - DAY",
      "Act II: INT. SCENE C - DAY",
    ]);
    const text = await readFile();
    expect(text).toContain("INT. SCENE A - DAY\n\nFreshly typed. A content.\n");
    expect(text).toContain("INT. SCENE B - DAY\n\nB content.\n");
  });

  it("drags a section, with its scenes, below another section", async function () {
    await nativeDrag(
      { section: "Act I", half: "top" },
      { section: "Act II", half: "bottom" },
    );
    await waitForOrder([
      "Act II: INT. SCENE C - DAY",
      "Act I: INT. SCENE A - DAY",
      "Act I: INT. SCENE B - DAY",
    ]);
    expect(await sectionOrder()).toEqual(["Act II", "Act I", "Act III"]);
  });

  it("moves a section up with the ••• menu", async function () {
    await chooseFromMoveMenu({ section: "Act III", half: "top" }, "Move up");
    await browser.waitUntil(
      async () =>
        JSON.stringify(await sectionOrder()) ===
        JSON.stringify(["Act I", "Act III", "Act II"]),
      { timeout: 5_000, timeoutMsg: "Act III did not move above Act II" },
    );
    await waitForOrder([
      "Act I: INT. SCENE A - DAY",
      "Act I: INT. SCENE B - DAY",
      "Act II: INT. SCENE C - DAY",
    ]);
  });

  it("ignores a section dropped onto itself", async function () {
    const before = await readFile();
    await nativeDrag(
      { section: "Act I", half: "top" },
      { section: "Act I", half: "bottom" },
    );
    await browser.pause(800);
    expect(await readFile()).toBe(before);
  });

  it("no longer offers the index card view", async function () {
    const exists = await browser.executeObsidian(
      ({ app }) =>
        !!(app as any).commands.commands["fountain-plus:toggle-index-cards-view"],
    );
    expect(exists).toBe(false);
  });
});
