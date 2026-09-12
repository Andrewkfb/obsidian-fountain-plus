import { type App, Modal, Notice, Setting } from "obsidian";
import { computeStatistics } from "./fountain/statistics";
import type { ScriptStatistics } from "./fountain/statistics";
import type { FountainScript } from "./fountain";
import { generateInstructions } from "./pdf/instruction_generator";
import type { PDFOptions } from "./pdf/options_dialog";
import type { SettingsHost } from "./settings";
import type { FountainView } from "./views/fountain_view";

/**
 * Page count, taken from the PDF pipeline's own pagination.
 *
 * A screenplay's length is a function of how it paginates, so an
 * estimate from character counts would be the wrong number. The
 * instruction generator is free of `pdf-lib` — only the renderer needs
 * it — so this stays off the plugin's load path.
 *
 * The title page gets its own page but is not page one of the script,
 * which is why it is subtracted back out.
 */
function countPages(script: FountainScript, options: PDFOptions): number | null {
  try {
    const instructions = generateInstructions(script, options);
    const pages = instructions.filter((i) => i.type === "new-page").length;
    if (pages === 0) return null;
    return script.titlePage !== null ? Math.max(pages - 1, 0) : pages;
  } catch (error) {
    // Pagination is a nice-to-have here; the rest of the numbers are
    // still worth showing if it fails.
    console.error("fountain: page count failed", error);
    return null;
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export class StatisticsModal extends Modal {
  constructor(
    app: App,
    private stats: ScriptStatistics,
  ) {
    super(app);
    this.setTitle("Script statistics");
  }

  onOpen() {
    const { contentEl, stats } = this;
    contentEl.empty();

    new Setting(contentEl).setName("Length").setHeading();

    new Setting(contentEl)
      .setName("Pages")
      .setDesc(
        "Counted by paginating the script exactly as the PDF export does.",
      )
      .addExtraButton((b) => b.setIcon("file-text").setDisabled(true))
      .then((setting) => {
        setting.controlEl.createSpan({
          text: stats.pages === null ? "—" : String(stats.pages),
          cls: "fountain-stat-value",
        });
      });

    const counts: [string, number][] = [
      ["Scenes", stats.scenes],
      ["Sections", stats.sections],
      ["Action paragraphs", stats.actionParagraphs],
      ["Dialogue blocks", stats.dialogueBlocks],
      ["Words", stats.totalWords],
    ];
    for (const [name, value] of counts) {
      new Setting(contentEl).setName(name).then((setting) => {
        setting.controlEl.createSpan({
          text: String(value),
          cls: "fountain-stat-value",
        });
      });
    }

    new Setting(contentEl).setName("Characters").setHeading();

    if (stats.characters.length === 0) {
      contentEl.createEl("p", {
        text: "No dialogue yet.",
        cls: "setting-item-description",
      });
      return;
    }

    // A plain table rather than Settings rows: this is data to scan down
    // a column, not a list of controls.
    const table = contentEl.createEl("table", { cls: "fountain-stats-table" });
    const head = table.createEl("thead").createEl("tr");
    for (const heading of ["Character", "Speeches", "Lines", "Words"]) {
      head.createEl("th", { text: heading });
    }
    const body = table.createEl("tbody");
    for (const character of stats.characters) {
      const row = body.createEl("tr");
      row.createEl("td", { text: character.name });
      row.createEl("td", { text: String(character.speeches) });
      row.createEl("td", { text: String(character.lines) });
      row.createEl("td", { text: String(character.words) });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

export function showStatisticsCommand(
  app: App,
  view: FountainView,
  settingsHost: SettingsHost,
): void {
  const script = view.getScript();
  const stats = computeStatistics(
    script,
    countPages(script, settingsHost.settings.pdf),
  );
  if (stats.scenes === 0 && stats.totalWords === 0) {
    new Notice("Nothing to count yet");
    return;
  }
  new StatisticsModal(app, stats).open();
}

export { plural };
