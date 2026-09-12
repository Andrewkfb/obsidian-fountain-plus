// Overview
// This is a parser for fountain.
// It largely tries to faithfully implement the spec.
// That said there are a few cases where it is on purpose more permissible
// than the spec.  In particular in some cases we want to recognize partial
// constructs, so that during interactive / incremental use, the right thing
// happens (TM).
//
// AST design rules (every-span-has-a-range, line-based-elements-own-
// their-lines, optional-markers-as-Range-or-null) are documented in
// `types.ts` near the AST element type definitions. When adding new
// syntax, check those rules and the contracts pinned by tests in
// `__tests__/{leading_whitespace,trailing_blank_line,
// structural_marker_mid_paragraph}.test.ts`.

{{
const { FountainScript } = require("./script");
const { mergeText } = require("./utils");
const {
  mkAction, mkBoneyard, mkBold, mkCenteredLine, mkDialogue, mkDialogueLine,
  mkItalics, mkKeyValue, mkLine, mkLyrics, mkNote, mkPageBreak, mkParenthetical,
  mkRange, mkScene, mkSection, mkSynopsis, mkText, mkTitlePage, mkTransition, mkUnderline,
  shiftLineStart,
} = require("./ast");

}}

Script
 = title:TitlePage? script:Element* !. { return new FountainScript(input, title ?? null, script); }

TitlePage
 = values:KeyValue+ "\n" { return mkTitlePage(range(), values); }

KeyValue
 = key:Key ":" [ \t]* values:(@InlineValue / @MultiLineValues) { return mkKeyValue(range(), key, values); }

Key
 = [a-zA-Z0-9_][a-zA-Z0-9_ ]* { return text() }

InlineValue = value:Value "\n" { return [value] }

Value
 = value:StyledTextElement+ { return mergeText(value); }

MultiLineValues
 = "\n" values:(@MultiLineValue "\n")+ { return values; }

MultiLineValue
 = (" "|3..| / "\t") value:Value { return value; }

PageBreak
 = "="|3..| NewLineOrEndOfInput { return mkPageBreak(range()); }

Element
 = Scene
 / PageBreak
 / Transition
 / Section
 / Synopsis
 / Lyrics
 / Dialogue
 / Action

LineTextElement
 = boneyard:Boneyard      { return boneyard; }
 / note:Note              { return note; }
 / text:StyledTextElement { return text; }

StyledTextElement
 = "**" elts:(!"**" @StyledTextElement)+ "**" { return mkBold(range(), mergeText(elts)); }
 / "*" elts:(!"*" @StyledTextElement)+ "*" { return mkItalics(range(), mergeText(elts)); }
 / "_" elts:(!"_" @StyledTextElement)+ "_" { return mkUnderline(range(), mergeText(elts)); }
 / PlainTextRun { return mkText(range()); }
 / (!"\n" .)  { return mkText(range()); }

// Fast path: consume a whole run of characters that cannot begin any
// other LineTextElement / StyledTextElement alternative in one match,
// so ordinary prose costs one AST node per run instead of one per
// character. The single-character fallback above still handles the
// excluded characters when their own alternative fails to match (an
// unpaired `*`, a lone `[`, a `/` that does not open a boneyard).
//
// Blanks need the `![/<]` guard: `Boneyard` and `EndOfCenteredLine`
// both start by consuming the blanks *before* their marker, so those
// blanks belong to that element's range rather than to the text run.
// Refusing to swallow them here leaves the original per-character path
// to make that call, which keeps every range byte-identical.
PlainTextRun
 = ( [^\n*_[/< \t]+ / [ \t]+ ![/<] )+

Line
 = elements:LineTextElement+ newline:("\n" / !.)
 { return mkLine(range(), mergeText(elements)); }



DialogueLine
 = !PageBreakPattern !StructuralMarkerStart @Line

DialogueContentItem
 = p:Parenthetical { return mkParenthetical(p); }
 / l:DialogueLine { return mkDialogueLine(l); }

DialogueContent
 = @items:DialogueContentItem+ DialogueTerminator

DialogueTerminator
 = &PageBreakPattern
 / &StructuralMarkerStart
 / NewLineOrEndOfInput

EndOfCenteredLine
 = [ \t]* ("<" !. / "<\n")

ActionLine
 = [ \t]*  ">" [ \t]* elements:(!EndOfCenteredLine @LineTextElement)+ EndOfCenteredLine
   { return mkCenteredLine(range(), mergeText(elements)); }
 / ForcedActionLine
 / !PageBreakPattern !StructuralMarkerStart @Line

PageBreakPattern
 = "="|3..|

// Lookahead for the start of a structural marker (Section `#`,
// Synopsis `=`). Used to terminate Action/Dialogue when a marker
// appears mid-paragraph so the marker isn't silently absorbed.
// PageBreak (`===`) is handled by `PageBreakPattern` separately;
// the order in `Element` ensures it wins for `===`-prefixed lines.
//
// TODO: extend with `~` (Lyrics) and the scene-heading prefixes
// (`INT.`/`EXT.`/`.SCENE`/etc.) when we want those recognized
// mid-paragraph too.
StructuralMarkerStart
 = "#" / "="

ForcedActionLine
 = "!" line:Line  { return shiftLineStart(line, -1); }

ActionLines
 = @lines:ActionLine+ ActionTerminator

ActionTerminator
 = &PageBreakPattern
 / &StructuralMarkerStart
 / NewLineOrEndOfInput

Transition
 = ">" transition:([^\n]*) !{ return transition.join("").endsWith("<") } BlankLineOrEndOfInput
 { return mkTransition(range(), true); }
 / OptionalBlanks (!("TO:\n"/"TO:" !.) [^\n] )* "TO:" BlankLineOrEndOfInput &{ const t = text(); return t.toUpperCase() === t; }
 { return mkTransition(range(), false); }

Action
 = lines:ActionLines
   { return mkAction(range(), lines); }
 / newline:NewLine
   { return mkAction(newline, [mkLine(newline, [])]); }

Note "note"
 = "[[" noteKind:NoteKind? noteText:NoteText "]]"?
 { return mkNote(range(), noteKind, noteText); }

NoteText
 =  (!("]]"/"\n\n") .)* { return range(); }

NoteKind
 = "+"   { return "+"; }
 / "-"   { return "-"; }
 / ">"   { return ">"; }
 / "@" marker:MarkerWord { return "@" + marker; }
 / kind:NoteKindName ":" " "* { return kind }

NoteKindName = [a-zA-Z0-9]+ { return text() }

MarkerWord = [a-zA-Z0-9_]* { return text() }

Boneyard "boneyard"
 = OptionalBlanks "/*" (!"*/" .)* "*/"
 { return mkBoneyard(range()); }

Section
 = hashes:Hashes RestOfLine NewLineOrEndOfInput
 { return mkSection(range(), hashes); }

Hashes
 = "#"+ { return text().length }

Synopsis
 = lines:SynopsisLine+ { return mkSynopsis(range(), lines); }

SynopsisLine
 = "=" @SynopsisLineInner NewLineOrEndOfInput

SynopsisLineInner
 = elements:LineTextElement* { return mkLine(range(), mergeText(elements)); }

NewLine
 = "\n" { return range() }

NewLineOrEndOfInput
 = "\n"
 / !.

Dialogue
 = OptionalBlanks character:Character [ \t]* exts:CharacterExtensions
   caret:DualMarker? "\n"
   content:DialogueContent
 { return mkDialogue(range(), character.nameRange, character.forcedMarkerRange, exts, content, caret); }

// The Fountain spec reads strictly as "the caret must be the last
// character on the line" — i.e., no trailing whitespace. We match
// Highland's lenient interpretation and accept whitespace before and
// after the `^`: writers paste invisible spaces in by accident, and
// flipping the semantics from dual-dialogue to "regular character
// whose name ends in `^   `" on the basis of a trailing space would
// be hostile UX. `BRICK ^`, `BRICK^`, `BRICK (V.O.)^   ` all parse.
DualMarker
 = [ \t]* caret:Caret [ \t]* { return caret; }

Caret
 = "^" { return mkRange(location()); }

Parenthetical
 = OptionalBlanks "(" [^)\n]* ")" "\n" { return range() }

CharacterExtensions
 = ([ \t]* "(" [^)\n]* ")")*  { return range() }

Character
 = !"@" name:MaybeName &{ return /[A-Za-z]/.test(name) && name.toUpperCase() === name }
   { return { nameRange: range(), forcedMarkerRange: null }; }
 / marker:ForcedMarker name:ForcedCharacterName
   { return { nameRange: name, forcedMarkerRange: marker }; }

ForcedMarker
 = "@" { return range(); }

ForcedCharacterName
 = [^(\n]+ { return range(); }

MaybeName
 = [^ >\t\n] NameChar* { return text() }

NameChar
 = !TrailingDualMarker !TrailingSpaceBeforeDualMarker [^a-z(\n]

// The caret marker forms a dual-dialogue indicator; we don't want to
// pull it (or the whitespace immediately before it) into the character
// name. Both negative lookaheads peek for `^` followed by optional
// whitespace and a newline.
TrailingDualMarker
 = "^" [ \t]* "\n"

TrailingSpaceBeforeDualMarker
 = [ \t]+ "^" [ \t]* "\n"

BlankLineOrEndOfInput
 = !.
 / "\n" !.
 / "\n\n"

RestOfLine = [^\n]* { return range() }

OptionalBlanks
 = [ \t]*

Lyrics
 = lines:LyricsLine+ LyricsTerminator
 { return mkLyrics(range(), lines); }

LyricsTerminator
 = &PageBreakPattern
 / NewLineOrEndOfInput

LyricsLine
 = "~" elements:LineTextElement* newline:("\n" / !.)
 { return mkLine(range(), mergeText(elements)); }


Scene
 = OptionalBlanks headingStart:SceneStart result:SceneHeadingAndNumber BlankLineOrEndOfInput {
   return mkScene(range(), headingStart.text + result.heading, headingStart.forced, result.number);
 }

SceneHeadingAndNumber
 = heading:SceneHeadingWithoutNumber sceneNumber:SceneNumber {
   return {
     heading: heading.trimEnd(),
     number: sceneNumber
   };
 }
 / heading:SceneHeadingPlain {
   return {
     heading: heading,
     number: null
   };
 }

SceneHeadingWithoutNumber
 = chars:(!SceneNumber [^\n])+ {
   return chars.map(c => c[1]).join('');
 }

SceneHeadingPlain
 = chars:[^\n]* {
   return chars.join('');
 }

SceneNumber
 = [ \t]* number:SceneNumberPrime [ \t]* &("\n" / !.) {
   return number;
 }

SceneNumberPrime
 = "#" [a-zA-Z0-9\-\.]+ "#" {
   return mkRange(location());
 }

SceneStart
 = ('.' &[a-zA-Z0-9] { return { text: '', forced: true }; }
 / prefix:("INT./EXT"i / "INT/EXT"i / "EXT"i / "EST"i / "INT"i / "I/E"i) separator:(" " / ".") { return { text: prefix + separator, forced: false }; })
