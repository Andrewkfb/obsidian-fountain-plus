import { type App, Notice, TFile } from "obsidian";
import { fdxToFountain, fountainToFdx } from "./fountain/fdx";
import { FuzzySelectString } from "./fuzzy_select_string";
import type { FountainView } from "./views/fountain_view";

/** The folder a file lives in, as a path prefix. Obsidian reports the
 *  vault root as "/", which would produce "/name.ext" — a path that
 *  never matches the "name.ext" the vault actually uses, so collision
 *  checks against it silently fail. */
function folderPrefix(file: TFile): string {
  const parent = file.parent?.path ?? "";
  return parent === "/" ? "" : parent;
}

/** Pick a vault path that doesn't collide, by appending " 1", " 2", … */
function uniquePath(app: App, folder: string, base: string, ext: string): string {
  const at = (name: string) => (folder ? `${folder}/${name}.${ext}` : `${name}.${ext}`);
  if (app.vault.getAbstractFileByPath(at(base)) === null) return at(base);
  let counter = 1;
  while (app.vault.getAbstractFileByPath(at(`${base} ${counter}`)) !== null) {
    counter++;
  }
  return at(`${base} ${counter}`);
}

/**
 * Export the active script as a Final Draft file beside it.
 *
 * Writes to a fresh path rather than overwriting: an `.fdx` in the vault
 * is as likely to be something imported from a collaborator as it is a
 * previous export, and clobbering theirs would be unrecoverable.
 */
export async function exportFdxCommand(
  app: App,
  view: FountainView,
): Promise<void> {
  const file = view.file;
  if (!file) {
    new Notice("No file is currently open");
    return;
  }
  try {
    const fdx = fountainToFdx(view.getScript());
    const path = uniquePath(app, folderPrefix(file), file.basename, "fdx");
    await app.vault.create(path, fdx);
    new Notice(`Exported ${path}`);
  } catch (error) {
    new Notice("Failed to export Final Draft file");
    console.error("fountain: fdx export failed", error);
  }
}

/**
 * Import a `.fdx` from the vault as a new `.fountain` file.
 *
 * Obsidian gives a plugin no file picker for arbitrary disk paths, so
 * this lists the `.fdx` files already in the vault — the user drops the
 * file in, then picks it here.
 */
export function importFdxCommand(app: App): void {
  const candidates = app.vault
    .getFiles()
    .filter((f) => f.extension.toLowerCase() === "fdx");

  if (candidates.length === 0) {
    new Notice(
      "No .fdx files in this vault — add one to the vault first, then run this command",
    );
    return;
  }

  const byPath = new Map(candidates.map((f) => [f.path, f]));
  new FuzzySelectString(
    app,
    "Which Final Draft file?",
    Array.from(byPath.keys()),
    (path) => {
      const file = byPath.get(path);
      if (!(file instanceof TFile)) return;
      void importOne(app, file);
    },
  ).open();
}

async function importOne(app: App, file: TFile): Promise<void> {
  try {
    const xml = await app.vault.read(file);
    const fountain = fdxToFountain(xml);
    if (fountain === null) {
      new Notice(`${file.name} is not a Final Draft document`);
      return;
    }
    const path = uniquePath(app, folderPrefix(file), file.basename, "fountain");
    const created = await app.vault.create(path, fountain);
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(created);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    new Notice(`Imported ${path}`);
  } catch (error) {
    new Notice("Failed to import Final Draft file");
    console.error("fountain: fdx import failed", error);
  }
}
