# Command Reference

This document lists all commands and keyboard shortcuts available in the Fountain plugin for Obsidian.

## Keyboard Shortcuts (scoped to fountain views)

These shortcuts work automatically when a fountain file has focus. No hotkey configuration needed.

| Shortcut | Action |
|----------|--------|
| Cmd/Ctrl+E | Toggle between edit and readonly mode |
| Cmd/Ctrl+F | Open search and replace |
| Cmd/Ctrl+Shift+X | Move selection to snippets |
| Cmd/Ctrl+Shift+C | Copy selection to snippets |

## Default Hotkeys (rebindable in Settings → Hotkeys)

These commands ship with a default binding but can be remapped from Obsidian's hotkey settings.

| Default | Command | Available when |
|---------|---------|----------------|
| Cmd/Ctrl+Shift+I | Toggle index card view | A fountain view is active |
| Cmd/Ctrl+Shift+L | Select current scene | The fountain editor (not cards / readonly) is active |

## Commands (via Command Palette)

Access these through Obsidian's command palette (Cmd/Ctrl+P) when a fountain file is open.

### New fountain document
Creates a new `.fountain` file in your vault.
- **Command ID**: `new-fountain-document`
- **Ribbon Icon**: Available (square pen icon)
- **Description**: Creates an untitled fountain file in the same directory as your currently active file, or in the root if no file is active. Automatically opens the new file in edit mode with focus.

### Generate PDF
Exports the current fountain script to a formatted PDF.
- **Command ID**: `generate-pdf`
- **Availability**: Only when a `.fountain` file is active
- **Description**: Opens a dialog with export options including paper size (Letter/A4), scene heading formatting, and file overwrite handling. Generates a PDF in the same directory as your fountain file.

### Edit title page
Creates or edits the script's title page through a dialog.
- **Command ID**: `edit-title-page`
- **Availability**: Only when a fountain view is active
- **Description**: Opens a dialog with a field per standard Fountain title page key — Title, Credit, Author, Source, Draft date, Contact — prefilled from the document's existing title page, or empty when it has none. Fields left blank are omitted (a key with no value would stop the whole title page from parsing), and clearing every field removes the title page. Any keys outside the standard set (`Copyright`, `Revision`, and so on) are preserved untouched and listed in the dialog; edit those directly in the document. Values keep their inline emphasis, so `*Star* Wars` stays italic markup.

### Script statistics
Shows page count, scene/section counts and per-character dialogue totals.
- **Command ID**: `script-statistics`
- **Availability**: Only when a fountain view is active
- **Description**: Page count is produced by paginating the script exactly as the PDF export does, rather than estimating from length. Per character it reports speeches, spoken lines and words, busiest first; parentheticals are excluded because nobody says them. A shared cue (`MARY & BOB`) credits both speakers.

### Export to Final Draft (.fdx)
Writes the current script as a Final Draft file next to it.
- **Command ID**: `export-final-draft`
- **Availability**: Only when a fountain view is active
- **Description**: Never overwrites: if `script.fdx` exists it writes `script 1.fdx`, since an `.fdx` in the vault is as likely to be a collaborator's file as a previous export. Sections, synopses and notes are deliberately omitted — they're your outline and annotations, not script content, and an `.fdx` is what gets sent to someone else.

### Import from Final Draft (.fdx)
Converts an `.fdx` in the vault into a new `.fountain` file and opens it.
- **Command ID**: `import-final-draft`
- **Availability**: Always
- **Description**: Lists the `.fdx` files already in your vault to pick from (Obsidian gives plugins no picker for arbitrary disk paths, so add the file to the vault first). Headings, cues and transitions that Fountain wouldn't recognise on their own are force-marked (`.`, `@`, `>`) so they survive as the right element type. Final Draft title pages are free-form layout, so only `Key: value` lines are carried across.

### Toggle edit mode
Switches between the editor and the readonly view.
- **Command ID**: `toggle-edit-mode`
- **Availability**: Only when a fountain view is active
- **Description**: Same as Cmd/Ctrl+E and the header's edit icon. Exists as a command so it can be rebound, and so it is reachable on a device with no hardware keyboard.

### Search and replace in script
Opens the editor's search panel.
- **Command ID**: `search-in-script`
- **Availability**: Only when the fountain editor is active
- **Description**: Same as Cmd/Ctrl+F. The shortcut is registered on the view rather than as a global hotkey so it doesn't collide with Obsidian's own "Search current file"; this command makes it reachable without a keyboard.

### Move selection to snippets / Copy selection to snippets
Moves or copies the current editor selection into the `# Snippets` section.
- **Command IDs**: `move-selection-to-snippets`, `copy-selection-to-snippets`
- **Availability**: Only when the fountain editor is active
- **Description**: Same as Cmd/Ctrl+Shift+X and Cmd/Ctrl+Shift+C.

### Open sidebar
Opens the fountain sidebar with table of contents and snippets.
- **Command ID**: `open-sidebar`
- **Availability**: Only when the sidebar is not already open
- **Description**: Opens the fountain-specific sidebar that displays the table of contents, synopsis toggles, and snippets section.

### Toggle spell check
Enables or disables spell checking in the editor.
- **Command ID**: `toggle-spell-check`
- **Availability**: Only when a fountain file is active
- **Description**: Toggles the browser's built-in spell checker for the current fountain view. Spell check is off by default to avoid distraction during creative writing. The setting persists while the file is open but resets when the file is closed.

### Add scene numbers
Automatically adds sequential scene numbers to scenes that don't already have them.
- **Command ID**: `add-scene-numbers`
- **Availability**: Only when a fountain file is active
- **Description**: Adds scene numbers in the format `#1#`, `#2#`, etc. to scenes. Preserves existing non-numeric scene numbers (like `#5A#`) and continues sequential numbering from existing numeric scene numbers.

### Remove scene numbers
Removes all scene numbers from all scenes in the document.
- **Command ID**: `remove-scene-numbers`
- **Availability**: Only when a fountain file is active
- **Description**: Strips all scene numbers from scene headings.

### Toggle index card view
Switches between the index card view and the editor (or readonly script), preserving position across the round-trip.
- **Command ID**: `toggle-index-cards-view`
- **Default Hotkey**: Cmd/Ctrl+Shift+I (rebindable)
- **Availability**: Only when a fountain view is active
- **Description**: From the editor, scrolls the card for the scene-under-cursor into view. From the cards, opens the editor at the start-of-scene-content of the topmost visible card. The remembered "where you came from" lets ⌘⇧I serve as a fluent round-trip without losing your place.

### Select current scene
Selects the entire current scene in the editor.
- **Command ID**: `select-current-scene`
- **Default Hotkey**: Cmd/Ctrl+Shift+L (rebindable)
- **Availability**: Only when a fountain editor is active (not the readonly or index card view)
- **Description**: Sets the editor selection to the whole `scene.range` — heading line through the line before the next scene/section heading. Designed as a primitive that composes with the system clipboard: `⌘X` to delete a scene, `⌘C` then `↓` then `⌘V` to duplicate, or cut-and-paste to move scenes across files.

## Content Filtering

These commands create filtered versions of your scripts for specific purposes (actor sides, technical scripts, etc.).

### Safety Features

All content filtering commands include these safety features:
- **Default behavior**: Creates a new filtered copy with "(filtered)" suffix, preserving your original
- **Unique naming**: Automatically handles naming conflicts (filtered, filtered 2, etc.)
- **Optional direct editing**: Can modify the current file if explicitly chosen in the modal
- **Warning**: Direct modification has no undo in readonly mode

### Remove character dialogue
- **Command ID**: `remove-character-dialogue`
- **Description**: Opens a modal with a scrollable list of all characters. Select characters whose dialogue you want to remove.

### Remove scenes and sections
- **Command ID**: `remove-scenes-sections`
- **Description**: Opens a hierarchical tree view of your script structure. Check sections to remove them.

### Remove element types
- **Command ID**: `remove-element-types`
- **Description**: Opens a modal to select which element types to remove (action lines, transitions, synopsis, notes, scene headers, etc.).
