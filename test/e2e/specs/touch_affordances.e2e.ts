import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

/** The index-card insertion controls (`+` / `#` gutters, `+ section`
 *  bars) sit at `opacity: 0` and are revealed on hover. A touch device
 *  never produces hover, so without a `(hover: none)` override those
 *  controls are invisible and unreachable — scene and section insertion
 *  silently disappear on an iPad.
 *
 *  The test environment is a desktop Electron with a real pointer, and
 *  this service exposes no CDP hook to emulate `hover: none`, so these
 *  assertions read the stylesheet rather than rendered opacity: they
 *  prove the override ships, targets the right selectors, and is not
 *  outranked by the `.dragging-active` rules. Rendering on a real tablet
 *  is not covered. */

describe("Touch affordances", function () {
  before(async function () {
    await obsidianPage.openFile("test.fountain");
    await browser.$(".screenplay").waitForExist({ timeout: 10_000 });
  });

  it("ships a (hover: none) override for the hover-revealed controls", async function () {
    const found = await browser.execute(() => {
      const wanted = [
        ".insertion-gutter",
        ".section-insert-bar",
        ".screenplay-index-card .pencil-button",
      ];
      const hits: Record<string, string | null> = {};
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = (sheet as CSSStyleSheet).cssRules;
        } catch {
          continue; // cross-origin sheet
        }
        for (const rule of Array.from(rules)) {
          if (!(rule instanceof CSSMediaRule)) continue;
          if (!rule.conditionText.replace(/\s/g, "").includes("hover:none")) {
            continue;
          }
          for (const inner of Array.from(rule.cssRules)) {
            if (!(inner instanceof CSSStyleRule)) continue;
            for (const sel of wanted) {
              if (inner.selectorText.includes(sel)) {
                hits[sel] = inner.style.getPropertyValue("opacity");
              }
            }
          }
        }
      }
      return hits;
    });

    // Every hover-gated control is forced visible on a hoverless device.
    expect(found[".insertion-gutter"]).toBe("1");
    expect(found[".section-insert-bar"]).toBe("1");
    expect(found[".screenplay-index-card .pencil-button"]).toBe("1");
  });

  it("keeps the drag grip out of the browser's scroll gesture", async function () {
    // Without `touch-action: none` the browser claims the pointer stream
    // for scrolling and the drag never receives a `pointermove`.
    const touchAction = await browser.execute(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = (sheet as CSSStyleSheet).cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          if (!(rule instanceof CSSStyleRule)) continue;
          if (
            rule.selectorText.includes(".drag-handle") &&
            rule.style.getPropertyValue("touch-action")
          ) {
            return rule.style.getPropertyValue("touch-action");
          }
        }
      }
      return null;
    });
    expect(touchAction).toBe("none");
  });
});
