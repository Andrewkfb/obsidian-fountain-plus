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

/** True when moving `range` to `pos` would leave the document unchanged:
 *  the scene would be reinserted where it already is. */
export function isNoOpSceneMove(range: Range, pos: number): boolean {
  return pos >= range.start && pos <= range.end;
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
