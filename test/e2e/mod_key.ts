/**
 * The platform's "Mod" key, for `browser.keys`.
 *
 * Obsidian binds shortcuts to `Mod`, which is Cmd on macOS and Ctrl
 * everywhere else. WebdriverIO's `"Meta"` maps to Cmd on macOS but to
 * the Super key on Linux, so a hard-coded `"Meta"` quietly stops
 * triggering anything once the suite runs on a Linux CI runner — the
 * editor never opens and every assertion downstream times out.
 */
export const MOD = process.platform === "darwin" ? "Meta" : "Control";
