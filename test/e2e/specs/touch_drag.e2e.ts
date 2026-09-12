import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

/** End-to-end tests for touch reordering of index cards.
 *
 *  The mouse path uses HTML5 drag-and-drop, which WebKit never fires from
 *  touch input — so on an iPad the grip does nothing and reordering is
 *  simply unavailable. `installTouchDragHandlers` reimplements the
 *  gesture on pointer events; these tests drive it with synthetic
 *  PointerEvents carrying `pointerType: "touch"`, aimed at real element
 *  coordinates so the handler's `elementFromPoint` hit-testing is
 *  genuinely exercised rather than stubbed. */

const FILE = "touch_moves.fountain";

const THREE_SCENES = [
  "Title: Touch Test",
  "",
  "INT. SCENE A - DAY",
  "",
  "Scene A content.",
  "",
  "INT. SCENE B - DAY",
  "",
  "Scene B content.",
  "",
  "INT. SCENE C - DAY",
  "",
  "Scene C content.",
  "",
].join("\n");

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

async function readFile(path: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, path: string) => {
    const f = app.vault.getAbstractFileByPath(path) as any;
    return await app.vault.read(f);
  }, path);
}

async function openCards(path: string): Promise<void> {
  await obsidianPage.openFile(path);
  // Only toggle when no cards are on screen yet: `toggleIndexCardsView`
  // is a toggle, so calling it unconditionally would switch a view that
  // is already showing cards back to the editor.
  if ((await browser.$$(".screenplay-index-card")).length === 0) {
    await browser.executeObsidian(({ app }, path: string) => {
      app.workspace.iterateAllLeaves((leaf) => {
        const v: any = leaf.view;
        if (v.getViewType?.() !== "fountain" || v.file?.path !== path) return;
        v.toggleIndexCardsView();
      });
    }, path);
  }
  await browser.waitUntil(
    async () => (await browser.$$(".screenplay-index-card")).length > 0,
    { timeout: 5_000, timeoutMsg: "expected index cards to render" },
  );
}

/** Drive a touch drag from the grip of the card whose heading contains
 *  `srcHeading` onto the left or right half of the card whose heading
 *  contains `dstHeading`. Coordinates come from real bounding rects. */
async function touchDrag(
  srcHeading: string,
  dstHeading: string,
  half: "left" | "right",
): Promise<void> {
  await browser.execute(
    (srcHeading: string, dstHeading: string, half: string) => {
      const cards = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".screenplay-index-card[data-range]",
        ),
      );
      const findCard = (needle: string) => {
        const card = cards.find((c) =>
          (c.textContent ?? "").includes(needle),
        );
        if (!card) throw new Error(`card not found: ${needle}`);
        return card;
      };
      const src = findCard(srcHeading);
      const dst = findCard(dstHeading);
      const handle = src.querySelector<HTMLElement>(".drag-handle");
      if (!handle) throw new Error("drag handle not found");

      const srcRect = handle.getBoundingClientRect();
      const dstRect = dst.getBoundingClientRect();
      const dstY = dstRect.top + dstRect.height / 2;
      // Well inside the chosen half, so the 50% rule is unambiguous.
      const dstX =
        half === "left"
          ? dstRect.left + dstRect.width * 0.25
          : dstRect.left + dstRect.width * 0.75;

      const fire = (type: string, x: number, y: number, target: Element) => {
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: "touch",
            isPrimary: true,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      };

      fire(
        "pointerdown",
        srcRect.left + srcRect.width / 2,
        srcRect.top + srcRect.height / 2,
        handle,
      );
      // Pointer capture would normally retarget these to the handle;
      // dispatching on the handle mirrors that.
      fire("pointermove", dstX, dstY, handle);
      fire("pointerup", dstX, dstY, handle);
    },
    srcHeading,
    dstHeading,
    half,
  );
}

function sceneOrder(text: string): string[] {
  return (text.match(/^INT\. SCENE ([A-Z]) - DAY$/gm) ?? []).map(
    (line) => line.replace(/^INT\. SCENE ([A-Z]) - DAY$/, "$1"),
  );
}

describe("Touch drag reordering of index cards", function () {
  beforeEach(async function () {
    await writeFile(FILE, THREE_SCENES);
    await openCards(FILE);
  });

  afterEach(async function () {
    await deletePath(FILE);
    await obsidianPage.resetVault();
  });

  it("starts a drag from the grip on touch input", async function () {
    const dragging = await browser.execute(() => {
      const card = document.querySelector<HTMLElement>(
        ".screenplay-index-card[data-range]",
      );
      const handle = card?.querySelector<HTMLElement>(".drag-handle");
      if (!handle || !card) throw new Error("no card/handle");
      const r = handle.getBoundingClientRect();
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
          clientX: r.left + 2,
          clientY: r.top + 2,
          bubbles: true,
          cancelable: true,
        }),
      );
      const started = card.classList.contains("dragging");
      handle.dispatchEvent(
        new PointerEvent("pointercancel", {
          pointerId: 1,
          pointerType: "touch",
          bubbles: true,
        }),
      );
      return started;
    });
    expect(dragging).toBe(true);
  });

  it("ignores mouse pointers, leaving those to native drag-and-drop", async function () {
    const dragging = await browser.execute(() => {
      const card = document.querySelector<HTMLElement>(
        ".screenplay-index-card[data-range]",
      );
      const handle = card?.querySelector<HTMLElement>(".drag-handle");
      if (!handle || !card) throw new Error("no card/handle");
      const r = handle.getBoundingClientRect();
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          clientX: r.left + 2,
          clientY: r.top + 2,
          bubbles: true,
          cancelable: true,
        }),
      );
      return card.classList.contains("dragging");
    });
    expect(dragging).toBe(false);
  });

  it("moves a scene after the card it is dropped on (right half)", async function () {
    expect(sceneOrder(await readFile(FILE))).toEqual(["A", "B", "C"]);

    await touchDrag("SCENE A", "SCENE B", "right");

    await browser.waitUntil(
      async () =>
        JSON.stringify(sceneOrder(await readFile(FILE))) ===
        JSON.stringify(["B", "A", "C"]),
      {
        timeout: 5_000,
        timeoutMsg: `expected B,A,C — got ${sceneOrder(await readFile(FILE))}`,
      },
    );
  });

  it("moves a scene before the card it is dropped on (left half)", async function () {
    await touchDrag("SCENE C", "SCENE A", "left");

    await browser.waitUntil(
      async () =>
        JSON.stringify(sceneOrder(await readFile(FILE))) ===
        JSON.stringify(["C", "A", "B"]),
      {
        timeout: 5_000,
        timeoutMsg: `expected C,A,B — got ${sceneOrder(await readFile(FILE))}`,
      },
    );
  });

  it("dropping a card on itself changes nothing", async function () {
    const before = await readFile(FILE);
    await touchDrag("SCENE B", "SCENE B", "right");
    await browser.pause(400);
    expect(await readFile(FILE)).toBe(before);
  });

  it("a cancelled drag leaves no drop indicators behind", async function () {
    const leftovers = await browser.execute(() => {
      const card = document.querySelector<HTMLElement>(
        ".screenplay-index-card[data-range]",
      );
      const handle = card?.querySelector<HTMLElement>(".drag-handle");
      if (!handle) throw new Error("no handle");
      const r = handle.getBoundingClientRect();
      const fire = (type: string) =>
        handle.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: "touch",
            isPrimary: true,
            clientX: r.left + 2,
            clientY: r.top + 2,
            bubbles: true,
            cancelable: true,
          }),
        );
      fire("pointerdown");
      fire("pointermove");
      fire("pointercancel");
      return {
        indicators: document.querySelectorAll(".drop-left, .drop-right").length,
        dragging: document.querySelectorAll(".screenplay-index-card.dragging")
          .length,
        active: document.querySelectorAll(".dragging-active").length,
      };
    });
    expect(leftovers).toEqual({ indicators: 0, dragging: 0, active: 0 });
  });
});
