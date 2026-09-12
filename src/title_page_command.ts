import { type App, Modal, Notice, Setting } from "obsidian";
import {
  TITLE_PAGE_KEYS,
  type TitlePageFields,
  type TitlePageKey,
  computeTitlePageEdits,
  titlePageFieldsAreEmpty,
  titlePageFieldsOf,
} from "./fountain/title_page";
import type { FountainView } from "./views/fountain_view";

/** Per-field help text. `Contact` and `Draft date` explain where they end
 *  up on the printed page, because that positioning is the whole reason
 *  Fountain distinguishes them from any other key. */
const FIELD_DESCRIPTIONS: Record<TitlePageKey, string> = {
  Title: "Centred on the title page. Emphasis markup works: *italic*.",
  Credit: 'Usually "written by" or "screenplay by".',
  Author: "Your name, as it should appear under the credit.",
  Source: 'Optional, e.g. "based on the novel by …".',
  "Draft date": "Printed in the lower right of the title page.",
  Contact: "Printed in the lower left. One line per line of the address.",
};

/** Fields that benefit from a multi-line input. */
const MULTILINE_FIELDS: ReadonlySet<TitlePageKey> = new Set(["Contact"]);

export class TitlePageDialog extends Modal {
  private fields: TitlePageFields;
  private readonly hadTitlePage: boolean;

  constructor(
    app: App,
    initial: TitlePageFields,
    hadTitlePage: boolean,
    private onSubmit: (fields: TitlePageFields) => void,
  ) {
    super(app);
    // Work on a copy so cancelling really cancels.
    this.fields = {
      known: { ...initial.known },
      other: initial.other.map(([k, v]): [string, string] => [k, v]),
    };
    this.hadTitlePage = hadTitlePage;
    this.setTitle(hadTitlePage ? "Edit title page" : "Create title page");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    for (const key of TITLE_PAGE_KEYS) {
      const setting = new Setting(contentEl)
        .setName(key)
        .setDesc(FIELD_DESCRIPTIONS[key]);

      if (MULTILINE_FIELDS.has(key)) {
        setting.addTextArea((text) => {
          text
            .setValue(this.fields.known[key])
            .onChange((value) => {
              this.fields.known[key] = value;
            });
          text.inputEl.rows = 3;
        });
      } else {
        setting.addText((text) => {
          text.setValue(this.fields.known[key]).onChange((value) => {
            this.fields.known[key] = value;
          });
        });
      }
    }

    // Custom keys aren't editable here, but the writer should know they
    // are kept rather than quietly dropped on save.
    if (this.fields.other.length > 0) {
      const names = this.fields.other.map(([k]) => k).join(", ");
      new Setting(contentEl)
        .setName("Other fields")
        .setDesc(
          `Kept unchanged: ${names}. Edit these directly in the document.`,
        )
        .setDisabled(true);
    }

    new Setting(contentEl)
      .addButton((btn) => {
        btn.setButtonText("Cancel").onClick(() => this.close());
      })
      .addButton((btn) => {
        btn
          .setButtonText("Save")
          .setCta()
          .onClick(() => {
            this.close();
            this.onSubmit(this.fields);
          });
      });
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Command implementation: open the title page dialog for `fountainView`,
 * creating a title page when the document has none.
 */
export function editTitlePageCommand(
  app: App,
  fountainView: FountainView,
): void {
  const script = fountainView.getScript();
  const hadTitlePage = script.titlePage !== null;

  const dialog = new TitlePageDialog(
    app,
    titlePageFieldsOf(script),
    hadTitlePage,
    (fields) => {
      // Re-read the script: the document may have changed while the modal
      // was open, and the stored ranges would then be stale.
      const current = fountainView.getScript();
      const edits = computeTitlePageEdits(current, fields);
      if (edits.length === 0) {
        new Notice("Title page unchanged");
        return;
      }
      fountainView
        .applyEditsToFile(edits)
        .then(() => {
          if (titlePageFieldsAreEmpty(fields)) {
            new Notice("Title page removed");
          } else {
            new Notice(hadTitlePage ? "Title page updated" : "Title page added");
          }
        })
        .catch((error) => {
          new Notice("Failed to update title page");
          console.error("Error updating title page:", error);
        });
    },
  );
  dialog.open();
}
