# 🔍 SCSS Class Finder

VS Code extension to find SCSS classes by their **resolved selector**, handling nesting and `&` (parent selector). Also supports **reverse navigation** — from a selector in SCSS/CSS to its usages in JS, TS, JSX, TSX, and HTML files.

## 💡 Why?

The goal is not "search a string in files". The goal is:

> Given a final selector like `.Bodycard-header`, find which SCSS rules generate it — even if they are written in nested form with `&`.

And **inversely**:

> Standing on a class or selector in a style file, jump to its usage in markup or code — respecting structural context (descendant, child, sibling combinators).

For example, searching `Bodycard-header` finds this:

```scss
.Bodycard {
  &-header { color: red; }
}
```

And from that SCSS rule, `F12` / `Cmd+Click` navigates to:

```jsx
<div className="Bodycard-header">...</div>
```

## ✨ Features

- 🔗 **Resolves nested selectors** — `&`-based concatenation (`&-header`, `&.active`, `&:hover`), multi-level nesting, and descendant selectors.
- 📋 **Comma-separated selector lists** — `.a, .b { &-x }` correctly expands to `.a-x` and `.b-x`.
- 🎯 **Smart matching** — results are filtered to **exact** and **endsWith** matches only, avoiding noisy partial hits.
- 🧭 **Go to Definition (forward)** — use `F12` / `Cmd+Click` on a CSS class name in JS, TS, JSX, TSX, or HTML files to jump directly to its SCSS definition.
- 🔄 **Go to Definition (reverse)** — use `F12` / `Cmd+Click` on a selector in SCSS, SASS, or CSS files to jump to where that class is used in code.
- 🔎 **Find All References** — use `Shift+F12` on a selector in SCSS/CSS to see all usages across JS/TS/JSX/TSX/HTML files.
- 🏗️ **Structural matching** — reverse navigation respects CSS combinators: descendant (` `), child (`>`), adjacent sibling (`+`), and general sibling (`~`).
- 📊 **Confidence scoring** — results are ranked by structural match quality: exact > structural > partial > probable.
- 🎨 **Multiple class patterns** — detects `class`, `className`, template literals, and `clsx`/`classnames`/`cx` helpers.
- 👁️ **Live preview** — navigating the results list previews each match in the editor.
- ✏️ **Cursor-aware** — pre-fills the search input with the word under the cursor.
- 🪶 **Zero dependencies** — custom single-pass lexer/parser, no external libraries. The packaged extension weighs ~15 KB.
- 🚫 **Skips noise** — ignores `node_modules`, `dist`, `build`, `coverage`, and all paths listed in `.gitignore`.
- 🧩 **Handles edge cases** — comments, strings, `@media`/`@supports` at-rules, and `#{}` interpolation.
- ⚡ **Cached & incremental** — template file extractions are cached in memory and invalidated by file watchers.

## 🚀 Usage

### Command Palette

1. Press `Cmd+Alt+F` (macOS) / `Ctrl+Alt+F` (Windows/Linux), or run **SCSS: Find Class by Resolved Selector** from the Command Palette.
2. Type the class name (e.g. `bodyCard-header`). The leading `.` is added automatically if omitted.
3. Browse the results — exact matches appear first.
4. Select a result to jump to its definition.

### Go to Definition (forward: code → styles)

In any JS, TS, JSX, TSX, or HTML file, place your cursor on a CSS class name and press `F12` (or `Cmd+Click`) to jump to its SCSS definition.

### Go to Definition (reverse: styles → code)

In any SCSS, SASS, or CSS file, place your cursor on a selector and press `F12` (or `Cmd+Click`) to jump to its usage in JS/TS/JSX/TSX/HTML.

### Find Class Usages

Press `Cmd+Alt+U` (macOS) / `Ctrl+Alt+U` (Windows/Linux) while in a SCSS/CSS file, or run **SCSS: Find Class Usages in Code** from the Command Palette. Shows a QuickPick with all usages sorted by match confidence.

### Find All References

In any SCSS, SASS, or CSS file, press `Shift+F12` on a selector to see all references in code files.

## 🏷️ Match Types (forward search)

| Icon | Type | Description |
|------|------|-------------|
| ✅ | **exact** | Resolved selector equals the search term exactly |
| 🔔 | **pseudoSuffix** | Selector starts with the search term followed by a pseudo-class/element |
| ➡️ | **endsWith** | Resolved selector ends with the search term as a separate segment |

## 🏗️ Match Confidence (reverse navigation)

| Icon | Confidence | Description |
|------|------------|-------------|
| ✅ | **exact** | Single class matches perfectly |
| 🏛️ | **structural** | Full selector chain verified against markup tree (all combinators match) |
| 🔔 | **partial** | More than half of the selector segments matched structurally |
| ❓ | **probable** | Target class found but weak structural context |

## 🏛️ Architecture

The reverse navigation pipeline has four stages:

1. **Selector IR** (`selectorIR.ts`) — Parses a resolved CSS selector into a chain of segments connected by combinators (descendant, child, adjacent, general sibling).
2. **Class Extractor** (`classExtractor.ts`) — Parses HTML/JSX/TSX files to build a tree of view nodes with class names, parent-child relationships, sibling indices, and exact source offsets.
3. **Structural Matcher** (`structuralMatcher.ts`) — Matches a selector chain against the view node tree, walking right-to-left and verifying each combinator relationship. Produces scored results.
4. **Extension Integration** (`extension.ts`) — Wires the pipeline into VS Code via DefinitionProvider, ReferenceProvider, and a QuickPick command, with in-memory caching and file watchers.

## ⚙️ Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `scssClassFinder.previewOnResultFocus` | `boolean` | `true` | Automatically preview and reveal the selected result while navigating the results list |

## 🛠️ Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Run unit tests
npm run test:unit

# Run integration tests
npm run test:integration

# Run all tests
npm test

# Package as .vsix
npm run package
```

## 📦 Install from Source

```bash
npm run compile
npx @vscode/vsce package --no-dependencies --allow-missing-repository
code --install-extension scss-class-finder-0.1.0.vsix
```
