import type { FountainScript } from "./script";
import type { Dialogue, Line } from "./types";
import { dialogueLines, extractTransitionText } from "./utils";

/// Final Draft (`.fdx`) interoperability.
///
/// `.fdx` is the format a script has to be in to leave the vault for a
/// collaborator, so this exists to stop a Fountain file being a dead
/// end. Both directions are deliberately lossy in documented ways
/// rather than silently approximate:
///
/// - **Fountain → FDX** drops sections, synopses and notes. They are
///   outline and annotation, not script content, and Final Draft has no
///   faithful equivalent; inventing one would put a writer's private
///   notes into a document they are sending to someone else.
/// - **FDX → Fountain** maps the body faithfully, and reads a title page
///   only where Final Draft's free-form title layout happens to contain
///   `Key: value` lines. Anything else there is layout, not data.
///
/// Both functions are pure string-to-string, so they are testable
/// without a vault.

const FDX_PARAGRAPH_TYPES = {
  sceneHeading: "Scene Heading",
  action: "Action",
  character: "Character",
  parenthetical: "Parenthetical",
  dialogue: "Dialogue",
  transition: "Transition",
} as const;

/** Scene-heading prefixes Fountain recognises without a forcing `.`. */
const SCENE_PREFIX =
  /^(INT\.|EXT\.|INT\.\/EXT\.|EXT\.\/INT\.|I\/E\.|EST\.)[ \t]/i;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function paragraph(type: string, text: string): string {
  return `    <Paragraph Type="${type}">\n      <Text>${escapeXml(text)}</Text>\n    </Paragraph>\n`;
}

/** Non-empty, trimmed text of each line in a block. */
function lineTexts(script: FountainScript, lines: Line[]): string[] {
  return lines
    .map((line) => script.sliceDocument(line.range).trim())
    .filter((text) => text.length > 0);
}

function dialogueParagraphs(
  script: FountainScript,
  dialogue: Dialogue,
): string {
  let out = "";
  const character = script
    .sliceDocument(dialogue.characterRange)
    .trim();
  if (character.length > 0) {
    out += paragraph(FDX_PARAGRAPH_TYPES.character, character);
  }
  for (const item of dialogue.content) {
    if (item.kind === "parenthetical") {
      const text = script.sliceDocument(item.range).trim();
      if (text.length > 0) {
        out += paragraph(FDX_PARAGRAPH_TYPES.parenthetical, text);
      }
    }
  }
  for (const text of lineTexts(script, dialogueLines(dialogue))) {
    out += paragraph(FDX_PARAGRAPH_TYPES.dialogue, text);
  }
  return out;
}

/**
 * Render `script` as a Final Draft document.
 *
 * Sections, synopses and notes are omitted — see the note at the top of
 * this file.
 */
export function fountainToFdx(script: FountainScript): string {
  let body = "";

  for (const element of script.script) {
    switch (element.kind) {
      case "scene": {
        // `heading` already excludes the scene number and the forcing
        // dot, which is exactly what Final Draft wants in the text.
        const heading = element.heading.trim();
        if (heading.length > 0) {
          body += paragraph(FDX_PARAGRAPH_TYPES.sceneHeading, heading);
        }
        break;
      }

      case "action":
      case "lyrics": {
        // Final Draft has no lyrics element; they read as action.
        for (const text of lineTexts(script, element.lines)) {
          body += paragraph(FDX_PARAGRAPH_TYPES.action, text);
        }
        break;
      }

      case "dialogue":
        body += dialogueParagraphs(script, element);
        break;

      case "transition":
        body += paragraph(
          FDX_PARAGRAPH_TYPES.transition,
          extractTransitionText(element, script),
        );
        break;

      default:
        // section, synopsis, page-break: intentionally not exported.
        break;
    }
  }

  let titlePage = "";
  if (script.titlePage !== null) {
    let entries = "";
    for (const kv of script.titlePage.keyValues) {
      const value = kv.values
        .map((line) =>
          line
            .map((span) => script.sliceDocument(span.range))
            .join("")
            .trim(),
        )
        .filter((line) => line.length > 0)
        .join(" ");
      if (value.length === 0) continue;
      entries += paragraph(FDX_PARAGRAPH_TYPES.action, `${kv.key}: ${value}`);
    }
    if (entries.length > 0) {
      titlePage = `  <TitlePage>\n    <Content>\n${entries}    </Content>\n  </TitlePage>\n`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<FinalDraft DocumentType="Script" Template="No" Version="1">\n  <Content>\n${body}  </Content>\n${titlePage}</FinalDraft>\n`;
}

/** A `Key: value` line, as Fountain's title page grammar accepts it. */
const TITLE_KEY_VALUE = /^([A-Za-z0-9_][A-Za-z0-9_ ]*):[ \t]*(.+)$/;

/** Force `text` to parse as action when it would otherwise be read as
 *  something else — an all-caps line becomes a character cue, and a
 *  leading `#`/`=`/`>` is a structural marker. */
function forceAction(text: string): string {
  const isAllCaps = /[A-Za-z]/.test(text) && text === text.toUpperCase();
  const startsMarker = /^[#=>!~.@]/.test(text);
  const readsAsTransition = /TO:$/.test(text);
  return isAllCaps || startsMarker || readsAsTransition ? `!${text}` : text;
}

function textOfParagraph(paragraphEl: Element): string {
  // Final Draft splits a styled run across several <Text> children;
  // concatenating them recovers the line. Styling itself is dropped:
  // mapping it back to Fountain emphasis is guesswork when a run
  // straddles word boundaries.
  const texts = Array.from(paragraphEl.getElementsByTagName("Text"));
  if (texts.length === 0) return "";
  return texts
    .map((t) => t.textContent ?? "")
    .join("")
    .trim();
}

/**
 * Convert a Final Draft document into Fountain source.
 *
 * Returns null when `xml` is not a parseable Final Draft document, so
 * the caller can report that rather than write a garbage file.
 */
export function fdxToFountain(xml: string): string | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  const root = doc.documentElement;
  if (!root || root.nodeName !== "FinalDraft") return null;

  // `<Content>` appears both at the top level and inside `<TitlePage>`;
  // the body is the one that is not inside the title page.
  const titlePageEl = root.getElementsByTagName("TitlePage")[0] ?? null;
  const contents = Array.from(root.getElementsByTagName("Content"));
  const bodyContent =
    contents.find((c) => !titlePageEl || !titlePageEl.contains(c)) ?? null;

  const out: string[] = [];

  if (titlePageEl !== null) {
    const entries: string[] = [];
    for (const p of Array.from(titlePageEl.getElementsByTagName("Paragraph"))) {
      const text = textOfParagraph(p);
      const match = TITLE_KEY_VALUE.exec(text);
      // Anything that isn't already a Key: value line is title-page
      // *layout*, which has no Fountain equivalent.
      if (match !== null) entries.push(`${match[1]}: ${match[2]}`);
    }
    if (entries.length > 0) {
      // No trailing newline: the block joiner supplies the blank line
      // that terminates a title page. Adding one here produced a second
      // blank line, which parses as an empty action element.
      out.push(entries.join("\n"));
    }
  }

  if (bodyContent !== null) {
    for (const p of Array.from(bodyContent.getElementsByTagName("Paragraph"))) {
      const type = p.getAttribute("Type") ?? "Action";
      const text = textOfParagraph(p);
      if (text.length === 0) continue;

      switch (type) {
        case FDX_PARAGRAPH_TYPES.sceneHeading:
          // Force headings Fountain wouldn't otherwise recognise, so a
          // Final Draft heading like "LATER" survives as a heading.
          out.push(SCENE_PREFIX.test(text) ? text : `.${text}`);
          break;

        case FDX_PARAGRAPH_TYPES.character:
          // A cue with lowercase in it needs forcing to be a cue at all.
          out.push(text === text.toUpperCase() ? text : `@${text}`);
          break;

        case FDX_PARAGRAPH_TYPES.parenthetical:
          out.push(text.startsWith("(") ? text : `(${text})`);
          break;

        case FDX_PARAGRAPH_TYPES.dialogue:
          out.push(text);
          break;

        case FDX_PARAGRAPH_TYPES.transition:
          out.push(/TO:$/.test(text) ? text : `> ${text}`);
          break;

        default:
          out.push(forceAction(text));
          break;
      }
    }
  }

  return `${joinFountainBlocks(out, bodyContent)}\n`;
}

/** Join rendered lines into Fountain source. Consecutive dialogue parts
 *  stay on adjacent lines; everything else is separated by a blank line.
 *  The types are re-derived from the same DOM so the joining rule lives
 *  in one place rather than being threaded through the loop above. */
function joinFountainBlocks(
  lines: string[],
  bodyContent: Element | null,
): string {
  if (bodyContent === null) return lines.join("\n\n");

  const paragraphs = Array.from(
    bodyContent.getElementsByTagName("Paragraph"),
  ).filter((p) => textOfParagraph(p).length > 0);

  // `lines` may carry a leading title-page block that has no matching
  // paragraph; line up from the end.
  const offset = lines.length - paragraphs.length;
  const dialoguePart = new Set<string>([
    FDX_PARAGRAPH_TYPES.character,
    FDX_PARAGRAPH_TYPES.parenthetical,
    FDX_PARAGRAPH_TYPES.dialogue,
  ]);

  let out = "";
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      const thisType =
        i >= offset
          ? (paragraphs[i - offset].getAttribute("Type") ?? "Action")
          : "Action";
      const prevType =
        i - 1 >= offset
          ? (paragraphs[i - 1 - offset].getAttribute("Type") ?? "Action")
          : "Action";
      const continuesDialogue =
        dialoguePart.has(thisType) &&
        dialoguePart.has(prevType) &&
        thisType !== FDX_PARAGRAPH_TYPES.character;
      out += continuesDialogue ? "\n" : "\n\n";
    }
    out += lines[i];
  }
  return out;
}
