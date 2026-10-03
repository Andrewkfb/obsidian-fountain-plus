import type {
  Edit,
  FountainScript,
  Range,
  ShowHideSettings,
} from "../fountain";

export type ReadonlyViewCallbacks = {
  getScript: () => FountainScript;
  reRender: () => void;
  requestSave: () => void;
  startEditModeHere: (range: Range) => void;
  startReadingModeHere: (range: Range) => void;
  replaceText: (range: Range, replacement: string) => void;
  getText: (range: Range) => string;
  /** Open a `[[>target]]` link target. `event` carries Mod/Shift modifiers. */
  openLink: (target: string, event: MouseEvent) => void;
};

export type Rehearsal = {
  character: string;
};

/** Layouts saved before the index card view was removed may still carry
 *  a `mode` field; it is ignored. */
export type ReadonlyViewPersistedState = {
  rehearsal?: Rehearsal; // This misses which dialogue(s) have been revealed, but is cheap and good enough
} & ShowHideSettings;

/** Stored in persistent state (workspace.json under the fountain key). */
export type FountainViewPersistedState = ReadonlyViewPersistedState & {
  editing?: boolean; // undefined => false
};

/** Common interface for the readonly and editor view states of a fountain document. */
export interface ViewState {
  readonly isEditMode: boolean;
  getViewData(): string;
  /**
   * Apply edits to the state. Editor dispatches them as CM changes so
   * cursor and undo survive; readonly ignores edits and re-renders from
   * `newScript`.
   */
  receiveEdits(edits: Edit[], newScript: FountainScript): void;
  /**
   * Adopt a new script wholesale, without edits. Editor replaces the CM
   * document; readonly re-renders. Used for external file reloads and for
   * propagating user-typed edits to sibling views.
   */
  receiveScript(newScript: FountainScript): void;
  setPath(path: string): void;
  clear(): void;
  destroy(): void;
  scrollToHere(r: Range): void;
  render(): void;
  focus(): void;
  setSpellCheck(enabled: boolean): void;
  hasSelection(): boolean;
  blackoutCharacter(): string | null;
  rangeOfFirstVisibleLine(): Range | null;
}

export function getSnippetsStartPosition(
  script: FountainScript,
): number | null {
  for (const element of script.script) {
    if (element.kind === "section") {
      const sectionText = script.sliceDocument(element.range);
      if (sectionText.toLowerCase().includes("snippets")) {
        return element.range.start;
      }
    }
  }
  return null;
}
