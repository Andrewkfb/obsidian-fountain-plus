/// Pure helpers for hiding the `.fountain` extension in how markdown notes
/// display `[[foo.fountain]]` wikilinks. Obsidian keeps the extension in
/// the link text of any non-markdown file; the link source must keep it
/// (that's how it resolves), so we only change what is shown.

const FOUNTAIN_EXTENSION = ".fountain";

export interface ExtensionRange {
  start: number;
  end: number;
}

/// Offsets of the `.fountain` extension within a wikilink target such as
/// `folder/Script.fountain#Heading`, or null if the target isn't a fountain
/// file. Headings and block refs (`#…`, `#^…`) follow the path, and an alias
/// (`|…`) is not part of the target.
export function fountainExtensionRange(target: string): ExtensionRange | null {
  const pathEnd = target.search(/[#|]/);
  const path = pathEnd === -1 ? target : target.slice(0, pathEnd);
  if (!path.toLowerCase().endsWith(FOUNTAIN_EXTENSION)) return null;
  return { start: path.length - FOUNTAIN_EXTENSION.length, end: path.length };
}

/// The text a rendered link should show once the extension is hidden.
/// `href` is the link target; `text` is what Obsidian rendered. Aliased
/// links don't start with the target path, so they come back unchanged.
export function stripFountainExtension(text: string, href: string): string {
  const range = fountainExtensionRange(href);
  if (!range) return text;
  const path = href.slice(0, range.end);
  if (!text.startsWith(path)) return text;
  return path.slice(0, range.start) + text.slice(range.end);
}
