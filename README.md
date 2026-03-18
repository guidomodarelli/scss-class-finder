# 🔍 SCSS Class Finder

VS Code extension to find SCSS classes by their **resolved selector**, handling nesting and `&` (parent selector).

When working with deeply nested SCSS, the actual CSS selector can be hard to trace back to its source. This extension resolves all selectors in your workspace and lets you search by the final compiled form.

## 💡 Why?

The goal is not "search a string in files". The goal is:

> Given a final selector like `.Bodycard-header`, find which SCSS rules generate it — even if they are written in nested form with `&`.

For example, searching `Bodycard-header` finds this:

```scss
.Bodycard {
  &-header { color: red; }
}
```

because the resolved selector is `.Bodycard-header`.

## ✨ Features

- 🔗 **Resolves nested selectors** — `&`-based concatenation (`&-header`, `&.active`, `&:hover`), multi-level nesting, and descendant selectors.
- 📋 **Comma-separated selector lists** — `.a, .b { &-x }` correctly expands to `.a-x` and `.b-x`.
- 🎯 **Smart matching** — results are filtered to **exact** and **endsWith** matches only, avoiding noisy partial hits.
- 👁️ **Live preview** — navigating the results list previews each match in the editor.
- ✏️ **Cursor-aware** — pre-fills the search input with the word under the cursor for quick confirmation or editing.
- 🪶 **Zero dependencies** — custom single-pass lexer/parser, no external SCSS libraries. The packaged extension weighs ~9 KB.
- 🚫 **Skips noise** — ignores `node_modules`, `dist`, `build`, and `coverage` directories.
- 🧩 **Handles edge cases** — comments, strings, `@media`/`@supports` at-rules, and `#{}` interpolation.

## 🚀 Usage

1. Press `Cmd+Alt+F` (macOS) / `Ctrl+Alt+F` (Windows/Linux), or run the command **SCSS: Find Class by Resolved Selector** from the Command Palette.
2. Type the class name (e.g. `bodyCard-header`). The leading `.` is added automatically if omitted.
3. Browse the results — exact matches appear first, followed by endsWith matches.
4. Select a result to jump to its definition.

## 🏷️ Match Types

| Icon | Type | Description |
|------|------|-------------|
| ✅ | **exact** | Resolved selector equals the search term exactly |
| ➡️ | **endsWith** | Resolved selector ends with the search term as a separate segment (e.g. `.parent .child` matches `.child`) |

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
