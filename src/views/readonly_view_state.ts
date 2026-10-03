import type {
  Edit,
  FountainScript,
  Range,
  ShowHideSettings,
} from "../fountain";
import { rangeOfFirstVisibleLine, renderFountain } from "./reading_view";
import {
  type ReadonlyViewCallbacks,
  type ReadonlyViewPersistedState,
  type ViewState,
} from "./view_state";

/** Renders the fountain script as HTML for reading and rehearsal mode. */
export class ReadonlyViewState implements ViewState {
  readonly isEditMode = false;
  public pstate: ReadonlyViewPersistedState;
  private contentEl: HTMLElement;
  private path: string;

  constructor(
    contentEl: HTMLElement,
    pstate: ReadonlyViewPersistedState,
    path: string,
    private callbacks: ReadonlyViewCallbacks,
  ) {
    this.contentEl = contentEl;
    this.path = path;
    this.pstate = pstate;
  }

  private get blackout(): string | null {
    return this.pstate.rehearsal?.character ?? null;
  }

  public stopRehearsalMode() {
    if (!this.pstate.rehearsal) return;
    this.pstate = { ...this.pstate, rehearsal: undefined };
    this.render();
  }

  startRehearsalMode(character: string) {
    // Rehearsal is a view-time override — it forces hide-all during
    // render without touching the stored show/hide settings.
    this.pstate = { ...this.pstate, rehearsal: { character } };
    this.render();
  }

  /** Is blackout mode active and for which character? */
  public blackoutCharacter(): string | null {
    return this.blackout;
  }

  private toggleBlackoutHandler(evt: Event) {
    const target = evt.target as HTMLElement;
    target.classList.toggle("blackout");
  }

  private installToggleBlackoutHandlers() {
    const blackouts = this.contentEl.querySelectorAll(".blackout");
    for (const bl of blackouts) {
      bl.addEventListener("click", (evt: Event) => {
        this.toggleBlackoutHandler(evt);
      });
    }
  }

  render() {
    this.contentEl.empty();
    // `parseFountain` guarantees a FountainScript: a document the
    // grammar rejects comes back as action lines rather than as an
    // error, so there is no failure case to handle here.
    const fp = this.callbacks.getScript();
    const mainblock = this.contentEl.createDiv("screenplay");
    const settings: ShowHideSettings = this.blackout
      ? { hideBoneyard: true, hideNotes: true, hideSynopsis: true }
      : this.pstate;
    renderFountain(mainblock, fp, settings, this.blackout ?? undefined);

    if (this.blackout) {
      this.installToggleBlackoutHandlers();
    }
    this.installLinkHandlers();
  }

  private installLinkHandlers() {
    const links = this.contentEl.querySelectorAll(".fountain-link");
    for (const link of links) {
      link.addEventListener("click", (evt: Event) => {
        const me = evt as MouseEvent;
        me.preventDefault();
        const target = (link as HTMLElement).getAttribute("data-link-target");
        if (target) this.callbacks.openLink(target, me);
      });
    }
  }

  scrollToHere(r: Range) {
    const targetElement = document.querySelector(`[data-range^="${r.start},"]`);
    targetElement?.scrollIntoView();
  }

  public setPersistentState(pstate: ReadonlyViewPersistedState) {
    this.pstate = pstate;
    this.render();
  }

  public setShowHideSettings(sh: ShowHideSettings) {
    this.pstate = { ...this.pstate, ...sh };
    this.render();
  }

  getViewData(): string {
    return this.callbacks.getScript().document;
  }

  receiveEdits(_edits: Edit[], _newScript: FountainScript): void {
    // Readonly has no CM to dispatch into; just re-render from the script
    // already stored on the parent FountainView.
    this.render();
  }

  receiveScript(_newScript: FountainScript): void {
    this.render();
  }

  setPath(path: string): void {
    this.path = path;
  }

  clear(): void {
    //TODO: When do I need this?
  }

  destroy(): void {}
  focus(): void {}
  setSpellCheck(_enabled: boolean): void {}
  hasSelection(): boolean {
    return false;
  }

  rangeOfFirstVisibleLine(): Range | null {
    const screenplay = this.contentEl.querySelector(".screenplay");
    if (screenplay === null) return null;
    return rangeOfFirstVisibleLine(screenplay as HTMLElement);
  }
}
