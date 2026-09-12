import { type App, type Plugin, PluginSettingTab, Setting } from "obsidian";
import type { PDFOptions } from "./pdf/options_dialog";

/// Plugin-level settings, persisted to `data.json`.
///
/// Deliberately only holds things that are a *default* rather than
/// per-document state: which way the PDF dialog opens, whether a freshly
/// opened script starts with spell check on. Per-view show/hide state
/// stays in the workspace layout where it already lives, so two panes on
/// the same file can differ — these settings only seed a new view.
///
/// This file must not import the plugin class: the view reads settings
/// through a getter to keep the dependency one-way.

export interface FountainSettings {
  /** Defaults for the PDF export dialog. The dialog still opens on every
   *  export — these decide what it opens *with*, so paper size and the
   *  notes/synopsis choices don't have to be re-picked every time. */
  pdf: PDFOptions;
  /** Whether the editor starts with spell check on. Off by default, to
   *  keep red squiggles out of a first draft. */
  spellCheckByDefault: boolean;
}

export const DEFAULT_SETTINGS: FountainSettings = {
  pdf: {
    sceneHeadingBold: true,
    paperSize: "letter",
    hideNotes: true,
    hideSynopsis: true,
    hideMarginMarks: false,
  },
  spellCheckByDefault: false,
};

/** Merge stored data over the defaults, one level into `pdf`, so a
 *  settings file written by an older version doesn't leave new keys
 *  undefined. */
export function mergeSettings(stored: unknown): FountainSettings {
  const data = (stored ?? {}) as Partial<FountainSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...data,
    pdf: { ...DEFAULT_SETTINGS.pdf, ...(data.pdf ?? {}) },
  };
}

export interface SettingsHost {
  settings: FountainSettings;
  saveSettings(): Promise<void>;
}

export class FountainSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private host: Plugin & SettingsHost,
  ) {
    super(app, host);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const { settings } = this.host;

    const save = () => {
      void this.host.saveSettings();
    };

    new Setting(containerEl).setName("Editor").setHeading();

    new Setting(containerEl)
      .setName("Spell check by default")
      .setDesc(
        "Start the editor with spell check on. Off keeps the red squiggles out of a first draft; the Toggle spell check command still flips it per session.",
      )
      .addToggle((toggle) =>
        toggle.setValue(settings.spellCheckByDefault).onChange((value) => {
          settings.spellCheckByDefault = value;
          save();
        }),
      );

    new Setting(containerEl).setName("PDF export defaults").setHeading();
    containerEl.createEl("p", {
      text: "The export dialog still opens every time — these are the values it opens with.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Paper size")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("letter", 'Letter (8.5" × 11")')
          .addOption("a4", "A4 (210 × 297 mm)")
          .setValue(settings.pdf.paperSize)
          .onChange((value) => {
            settings.pdf.paperSize = value as "letter" | "a4";
            save();
          }),
      );

    new Setting(containerEl)
      .setName("Bold scene headings")
      .addToggle((toggle) =>
        toggle.setValue(settings.pdf.sceneHeadingBold).onChange((value) => {
          settings.pdf.sceneHeadingBold = value;
          save();
        }),
      );

    new Setting(containerEl)
      .setName("Hide synopsis")
      .setDesc("Exclude synopsis lines from the PDF.")
      .addToggle((toggle) =>
        toggle.setValue(settings.pdf.hideSynopsis).onChange((value) => {
          settings.pdf.hideSynopsis = value;
          save();
        }),
      );

    new Setting(containerEl)
      .setName("Hide notes")
      .setDesc("Exclude notes from the PDF.")
      .addToggle((toggle) =>
        toggle.setValue(settings.pdf.hideNotes).onChange((value) => {
          settings.pdf.hideNotes = value;
          save();
        }),
      );

    new Setting(containerEl)
      .setName("Hide margin marks")
      .setDesc("Exclude margin marks ([[@word]]) from the PDF.")
      .addToggle((toggle) =>
        toggle.setValue(settings.pdf.hideMarginMarks).onChange((value) => {
          settings.pdf.hideMarginMarks = value;
          save();
        }),
      );
  }
}
