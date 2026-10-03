import type { FountainScript } from "./script";
import type { Range, StructureScene, StructureSection } from "./types";

function flattenScenes(
  sections: StructureSection[],
): StructureScene[] {
  const result: StructureScene[] = [];
  for (const section of sections) {
    for (const child of section.content) {
      // Only keep "real" scenes — ones with an actual heading. The
      // structure builder also produces synthetic scene buckets for
      // pre-heading action lines; those carry no heading and aren't
      // navigation targets.
      if (child.scene) result.push(child);
    }
  }
  return result;
}

/**
 * Walk the script's structure and return the scene whose range contains
 * `offset`. If `offset` precedes the first scene (e.g. cursor on the title
 * page or a section header), return the next scene. Returns null only when
 * the script has no scenes at all.
 */
export function findSceneAtOffset(
  script: FountainScript,
  offset: number,
): StructureScene | null {
  const scenes = flattenScenes(script.structure().sections);
  if (scenes.length === 0) return null;
  for (let i = 0; i < scenes.length; i++) {
    const r = scenes[i].range;
    if (offset < r.start) return scenes[i];
    if (offset < r.end) return scenes[i];
  }
  return scenes[scenes.length - 1];
}

/** Where a scene dropped onto `section`'s heading lands: in front of the
 *  section's first scene, or right after the heading (and synopsis) when
 *  the section has no scenes yet. */
export function sectionDropPosition(section: StructureSection): number {
  const first = section.content.find((c) => c.scene);
  return first ? first.range.start : section.range.end;
}

/** True when moving `range` to `pos` would leave the document unchanged
 *  (or put the block inside itself): `pos` lies within `range`. */
export function isNoOpMove(range: Range, pos: number): boolean {
  return pos >= range.start && pos <= range.end;
}

/**
 * The text a section owns: its heading through the end of the last section
 * before the next heading at the same or a shallower depth. Moving that
 * range moves the section with its scenes and subsections. Returns null
 * when no section heading starts at `sectionStart`.
 */
export function sectionBlockRange(
  script: FountainScript,
  sectionStart: number,
): Range | null {
  const sections = script.structure().sections;
  const i = sections.findIndex((s) => s.section?.range.start === sectionStart);
  if (i === -1) return null;
  const depth = sections[i].section?.depth ?? 1;
  let last = i;
  while (
    last + 1 < sections.length &&
    (sections[last + 1].section?.depth ?? 1) > depth
  ) {
    last++;
  }
  return { start: sectionStart, end: sections[last].range.end };
}

/**
 * Insertion positions for moving the section starting at `sectionStart`
 * one step up or down past a sibling (a section of the same depth with no
 * shallower heading in between). Both sections move as whole blocks.
 * `null` means there is no sibling in that direction.
 */
export function sectionMoveTargets(
  script: FountainScript,
  sectionStart: number,
): { up: number | null; down: number | null } {
  const sections = script.structure().sections;
  const i = sections.findIndex((s) => s.section?.range.start === sectionStart);
  if (i === -1) return { up: null, down: null };
  const depth = sections[i].section?.depth ?? 1;
  const sibling = (from: number, step: number): number | null => {
    for (let k = from; k >= 0 && k < sections.length; k += step) {
      const d = sections[k].section?.depth;
      // A headless leading section or a shallower heading ends the run of
      // siblings.
      if (d === undefined || d < depth) return null;
      if (d === depth) return sections[k].section?.range.start ?? null;
    }
    return null;
  };
  const prev = sibling(i - 1, -1);
  const next = sibling(i + 1, 1);
  return {
    up: prev,
    down: next === null ? null : (sectionBlockRange(script, next)?.end ?? null),
  };
}

/**
 * Insertion positions for moving the scene starting at `sceneStart` one
 * step up or down in the outline. Within a section a step swaps with the
 * neighbouring scene; at a section boundary it crosses into the
 * neighbouring section (end of the previous one, or start of the next).
 * `null` means there is nowhere to go in that direction.
 */
export function sceneMoveTargets(
  script: FountainScript,
  sceneStart: number,
): { up: number | null; down: number | null } {
  const sections = script.structure().sections;
  for (let i = 0; i < sections.length; i++) {
    const scenes = sections[i].content.filter((c) => c.scene);
    const j = scenes.findIndex((c) => c.range.start === sceneStart);
    if (j === -1) continue;
    const heading = sections[i].section;
    const next = sections[i + 1];
    // Inserting at a section's own heading lands the scene at the end of
    // the previous section, so the first section has nowhere further up.
    const up =
      j > 0
        ? scenes[j - 1].range.start
        : heading && i > 0
          ? heading.range.start
          : null;
    const down =
      j < scenes.length - 1
        ? scenes[j + 1].range.end
        : next
          ? sectionDropPosition(next)
          : null;
    return { up, down };
  }
  return { up: null, down: null };
}

/** A section heading's title without its leading `#`s. */
export function sectionTitle(
  script: FountainScript,
  section: StructureSection,
): string {
  const heading = section.section;
  if (!heading) return "";
  return script.sliceDocument(heading.range).slice(heading.depth).trim();
}

/**
 * Identifies a scene or section in the outline by its position among its
 * kind plus its visible label, rather than by character offsets. Offsets
 * go stale as soon as the script is edited; a reference is resolved
 * against the current script at the moment it is used, and refuses to
 * resolve if the label no longer matches.
 */
export type OutlineRef = {
  kind: "scene" | "section";
  index: number;
  label: string;
};

/** Resolve `ref` in `script`: the block to move (a scene, or a section
 *  with everything under it) and its start. Null when the outline item no
 *  longer exists or its label changed. */
export function resolveOutlineRef(
  script: FountainScript,
  ref: OutlineRef,
): { range: Range; section?: StructureSection } | null {
  const sections = script.structure().sections;
  if (ref.kind === "scene") {
    const scene = flattenScenes(sections)[ref.index];
    if (!scene?.scene || scene.scene.heading !== ref.label) return null;
    return { range: scene.range };
  }
  const section = sections.filter((s) => s.section)[ref.index];
  if (!section?.section || sectionTitle(script, section) !== ref.label) {
    return null;
  }
  const range = sectionBlockRange(script, section.section.range.start);
  return range ? { range, section } : null;
}

