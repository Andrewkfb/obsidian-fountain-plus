import type {
  Dialogue,
  FountainElement,
  Line,
  Note,
  PageBreak,
  Range,
  ScriptStructure,
  Snippets,
  TextElementWithNotesAndBoneyard,
  TitlePage,
} from "./types";
import { StructureScene, StructureSection } from "./types";
import {
  applyDualPairing,
  filterDialogueContent,
  maybeEscapeLeadingSpaces,
  mergeConsecutiveActions,
} from "./utils";

export class FountainScript {
  readonly titlePage: TitlePage | null;
  readonly script: FountainElement[];
  readonly document: string;
  readonly allCharacters: Set<string>;
  /** Memoized `structure()` result. A FountainScript is immutable once
   *  constructed, so the structure derived from it is too. The fold
   *  service asks for it once per visible line on every viewport
   *  change, which made recomputation show up while scrolling. */
  private cachedStructure: ScriptStructure | null = null;
  /** Memoized `withHiddenElementsRemoved` results, keyed by the settings
   *  that produced them. The readonly view rebuilds a filtered script on
   *  every re-render, and a rebuild re-runs dual pairing and the
   *  character scan over the whole document. There are only eight
   *  possible keys, so this is bounded by construction. */
  private cachedFiltered = new Map<string, FountainScript>();

  constructor(
    document: string,
    titlePage: TitlePage | null,
    script: FountainElement[],
  ) {
    this.document = document;
    this.titlePage = titlePage;
    this.script = applyDualPairing(mergeConsecutiveActions(script));
    const characters = new Set<string>();
    for (const el of this.script) {
      switch (el.kind) {
        case "dialogue":
          for (const c of this.charactersOf(el)) {
            characters.add(c);
          }
          break;
        default:
          break;
      }
    }
    this.allCharacters = characters;
  }

  /** Extract text from the fountain document. */
  sliceDocument(r: Range): string {
    return this.document.slice(r.start, r.end);
  }

  /** Extract text from the fountain document for display.
      Leading spaces are replaced with non-breaking spaces. */
  sliceDocumentForDisplay(r: Range): string {
    return maybeEscapeLeadingSpaces(true, this.document.slice(r.start, r.end));
  }

  /**
   * Return list of characters that are saying this dialogue.
   * Normally this will be an array of one element. But in an
   * extension to standard fountain we also allow multiple characters
   * separated by & characters.
   * NOTE: the character names are NOT html escaped!
   * @param d Dialogue
   */
  charactersOf(d: Dialogue): string[] {
    const text = this.document.slice(
      d.characterRange.start,
      d.characterRange.end,
    );
    return text.split("&").map((s) => s.trim());
  }

  with_source(): (FountainElement & { source: string })[] {
    return this.script.map((elt) => {
      return {
        ...elt,
        source: this.document.slice(elt.range.start, elt.range.end),
      };
    });
  }

  /** Return a structured representation of the script.
      Note that in this representation the first synopsis of a section
      or scene will not appear inside content, but inside the synopsis
      field. Even when empty action lines (which will appear inside content)
      are between the scene or section header and the synopsis.
      So if an exact reproduction of the document or the order
      in which the elements appear in the script is important, use this.script()
      instead.
  */
  structure(): ScriptStructure {
    if (this.cachedStructure !== null) return this.cachedStructure;
    const structure = this.computeStructure();
    this.cachedStructure = structure;
    return structure;
  }

  private computeStructure(): ScriptStructure {
    const [mainElements, snippetElements] = this.splitOffSnippetsSection();

    const sections: StructureSection[] = [];
    let currentSection = new StructureSection();
    let currentScene = new StructureScene();

    const isSceneEmpty = () =>
      !currentScene.scene && !currentScene.content.length;
    const isSectionEmpty = () =>
      isSceneEmpty() &&
      !currentSection.section &&
      !currentSection.synopsis &&
      !currentSection.content.length;
    const sceneHasOnlyBlankLines = () =>
      currentScene.content.every(
        (fe) =>
          fe.kind === "action" && fe.lines.every((l) => !l.elements.length),
      );

    /** Push the in-progress scene onto its section and start fresh. */
    const flushScene = () => {
      if (!isSceneEmpty()) {
        currentSection.content.push(currentScene);
        currentScene = new StructureScene();
      }
    };
    /** Close the in-progress section, which closes the in-progress scene
     *  first. Called both when a new section heading arrives and at the
     *  end of the input. */
    const flushSection = () => {
      flushScene();
      if (!isSectionEmpty()) {
        sections.push(currentSection);
        currentSection = new StructureSection();
      }
    };

    for (const fe of mainElements) {
      switch (fe.kind) {
        case "section":
          if (fe.depth > 3) {
            // Depth ≥ 4 headings are scene-internal subsections, not
            // structural breaks. They flow into the current scene's
            // content alongside dialogue and action.
            currentScene.content.push(fe);
          } else if (isSectionEmpty()) {
            // First heading of the doc — adopt as the synthetic root
            // section's title rather than pushing an empty bucket and
            // starting a new section.
            currentSection.section = fe;
          } else {
            flushSection();
            currentSection.section = fe;
          }
          break;

        case "scene":
          flushScene();
          currentScene = new StructureScene(fe);
          break;

        case "synopsis":
          // Section synopsis: a `=` line right after a section heading
          // (no scenes yet, only blank-line actions between) attaches
          // to `currentSection.synopsis`. The matching scene-synopsis
          // case is computed on demand by `StructureScene.synopsis` —
          // we just push to content and let the getter find it.
          // TODO: Deal with boneyards.
          if (
            !currentScene.scene &&
            sceneHasOnlyBlankLines() &&
            currentSection.section &&
            !currentSection.synopsis &&
            !currentSection.content.length
          ) {
            currentSection.synopsis = fe;
          } else {
            currentScene.content.push(fe);
          }
          break;

        default:
          currentScene.content.push(fe);
          break;
      }
    }
    flushSection();

    return {
      sections,
      snippets: this.parseSnippets(snippetElements),
    };
  }

  /** Split `script` at the first depth-≤-3 `# … Snippets …` section.
   *  The header itself is dropped; everything before goes to `main`,
   *  everything after to `snippet`. Returns `[script, []]` when there
   *  is no snippets section. */
  private splitOffSnippetsSection(): [FountainElement[], FountainElement[]] {
    const idx = this.script.findIndex(
      (fe) =>
        fe.kind === "section" &&
        fe.depth <= 3 &&
        this.sliceDocument(fe.range).toLowerCase().includes("snippets"),
    );
    if (idx === -1) return [this.script, []];
    return [this.script.slice(0, idx), this.script.slice(idx + 1)];
  }

  private parseSnippets(elements: FountainElement[]): Snippets {
    const snippets: Snippets = [];
    let currentContent: FountainElement[] = [];

    for (const fe of elements) {
      if (fe.kind === "page-break") {
        if (currentContent.length > 0) {
          snippets.push({ content: currentContent, pageBreak: fe });
          currentContent = [];
        }
      } else {
        currentContent.push(fe);
      }
    }

    if (currentContent.length > 0) {
      snippets.push({ content: currentContent });
    }

    return snippets;
  }

  /**
   * Returns a copy of this FountainScript with hidden elements removed.
   * Lines that become empty after removing hidden elements are also removed.
   * Action blocks that contained only lines that are now completely removed are fully removed.
   */
  withHiddenElementsRemoved(settings: {
    hideBoneyard?: boolean;
    hideNotes?: boolean;
    hideSynopsis?: boolean;
  }): FountainScript {
    const key = `${settings.hideBoneyard ?? false}|${settings.hideNotes ?? false}|${settings.hideSynopsis ?? false}`;
    const cached = this.cachedFiltered.get(key);
    if (cached !== undefined) return cached;
    const filtered = this.computeWithHiddenElementsRemoved(settings);
    this.cachedFiltered.set(key, filtered);
    return filtered;
  }

  private computeWithHiddenElementsRemoved(settings: {
    hideBoneyard?: boolean;
    hideNotes?: boolean;
    hideSynopsis?: boolean;
  }): FountainScript {
    const filteredScript: FountainElement[] = [];

    for (const element of this.script) {
      // Check for boneyard section - if found and hideBoneyard is true, stop processing
      if (element.kind === "section" && settings.hideBoneyard) {
        const title = this.sliceDocument(element.range);
        if (
          title
            .toLowerCase()
            .replace(/^ *#+ */, "")
            .trimEnd() === "boneyard"
        ) {
          // Stop processing here - everything after boneyard is hidden
          break;
        }
      }

      const filteredElement = this.filterFountainElement(element, settings);
      if (filteredElement !== null) {
        filteredScript.push(filteredElement);
      }
    }

    return new FountainScript(this.document, this.titlePage, filteredScript);
  }

  private filterLines(
    lines: Line[],
    settings: { hideBoneyard?: boolean; hideNotes?: boolean },
  ): Line[] {
    return lines
      .map((line) => this.filterLine(line, settings))
      .filter((line): line is Line => line !== null);
  }

  private filterFountainElement(
    element: FountainElement,
    settings: {
      hideBoneyard?: boolean;
      hideNotes?: boolean;
      hideSynopsis?: boolean;
    },
  ): FountainElement | null {
    switch (element.kind) {
      case "synopsis": {
        if (settings.hideSynopsis) return null;
        const filteredLines = this.filterLines(element.lines, settings);
        return { ...element, lines: filteredLines };
      }

      case "action": {
        const filteredLines = this.filterLines(element.lines, settings);
        if (filteredLines.length === 0) {
          return null;
        }
        return { ...element, lines: filteredLines };
      }

      case "dialogue": {
        const filteredContent = filterDialogueContent(
          element.content,
          (line) => this.filterLine(line, settings),
        );
        return { ...element, content: filteredContent };
      }

      default:
        return element;
    }
  }

  private filterLine(
    line: Line,
    settings: { hideBoneyard?: boolean; hideNotes?: boolean },
  ): Line | null {
    const filteredElements = line.elements.filter((element) =>
      this.shouldKeepElement(element, settings),
    );

    // If line was originally empty, preserve it
    if (line.elements.length === 0) {
      return line;
    }

    // If line became empty after filtering, remove it
    if (filteredElements.length === 0) {
      return null;
    }

    return {
      ...line,
      elements: filteredElements,
    };
  }

  private shouldKeepElement(
    element: TextElementWithNotesAndBoneyard,
    settings: { hideBoneyard?: boolean; hideNotes?: boolean },
  ): boolean {
    switch (element.kind) {
      case "note":
        return !settings.hideNotes;
      case "boneyard":
        return !settings.hideBoneyard;
      case "text":
      case "bold":
      case "italics":
      case "underline":
        return true;
      default:
        return true;
    }
  }
}
