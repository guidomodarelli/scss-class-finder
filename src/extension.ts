import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SelectorInfo {
  /** 0-based line number where the selector text starts */
  line: number;
  /** Fully resolved CSS selector (e.g. ".bodyCard-header") */
  resolved: string;
  /** Raw SCSS selector as written in the source (e.g. "&-header") */
  raw: string;
}

interface SearchResult {
  uri: vscode.Uri;
  line: number;
  resolved: string;
  raw: string;
  matchType: 'exact' | 'endsWith' | 'contains';
}

interface QuickPickItemWithResult extends vscode.QuickPickItem {
  result: SearchResult;
}

// ---------------------------------------------------------------------------
// Selector Resolution Engine
// ---------------------------------------------------------------------------

/**
 * Split a selector list by commas, respecting parentheses so that
 * commas inside `:has()`, `:not()`, `:is()` etc. are not treated
 * as selector separators.
 */
function splitSelectors(raw: string): string[] {
  const results: string[] = [];
  let current = '';
  let parenDepth = 0;

  for (const ch of raw) {
    if (ch === '(') { parenDepth++; }
    if (ch === ')') { parenDepth--; }
    if (ch === ',' && parenDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) { results.push(trimmed); }
      current = '';
    } else {
      current += ch;
    }
  }

  const trimmed = current.trim();
  if (trimmed) { results.push(trimmed); }
  return results;
}

/**
 * Parse an SCSS file's text and return every rule's resolved selector
 * together with its source line number.
 *
 * Handles:
 *  - `&`-based suffix/prefix concatenation  (`&-header`, `&.active`, `&:hover`)
 *  - Multi-level nesting                    (`&-main { &-uncollapsed }`)
 *  - Normal descendant nesting              (`.parent { .child }`)
 *  - Comma-separated selector lists         (`.a, .b { &-x }`)
 *  - `@media` / `@supports` / other at-rules (pass-through parent)
 *  - Line & block comments
 *  - Strings (single & double quoted)
 *  - `#{ }` interpolation (not mistaken for a block)
 *  - Selectors containing `:has()`, `:not()`, etc. with inner commas
 */
function resolveSelectors(text: string): SelectorInfo[] {
  const results: SelectorInfo[] = [];

  let pos = 0;
  let line = 0;

  // Lexer state
  let inBlockComment = false;
  let inLineComment = false;
  let inString: string | null = null;

  // Selector accumulation
  let selectorStart = 0;     // character offset where current selector text begins
  let selectorLine = 0;      // line of first non-WS char of current selector
  let seenNonWS = false;     // whether we've seen a non-whitespace char since last reset

  // Stack of resolved selectors per nesting depth.
  // Level 0 = root (virtual empty parent).
  const parentStack: string[][] = [['']];

  function resetSelector(from: number) {
    selectorStart = from;
    seenNonWS = false;
  }

  while (pos < text.length) {
    const ch = text[pos];
    const next = pos + 1 < text.length ? text[pos + 1] : '';

    // ---- strings (consume everything until closing quote) ----
    if (inString) {
      if (ch === '\n') { line++; }
      if (ch === inString && (pos === 0 || text[pos - 1] !== '\\')) {
        inString = null;
      }
      pos++;
      continue;
    }

    // ---- block comment ----
    if (inBlockComment) {
      if (ch === '\n') { line++; }
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        pos += 2;
      } else {
        pos++;
      }
      continue;
    }

    // ---- line comment ----
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        line++;
        pos++;
        resetSelector(pos);
      } else {
        pos++;
      }
      continue;
    }

    // ---- detect comment starts ----
    if (ch === '/' && next === '/') {
      inLineComment = true;
      pos += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      pos += 2;
      continue;
    }

    // ---- detect string starts ----
    if (ch === '"' || ch === "'") {
      inString = ch;
      pos++;
      continue;
    }

    // ---- newlines ----
    if (ch === '\n') {
      line++;
      pos++;
      continue;
    }

    // ---- SCSS interpolation  #{...}  — don't treat inner braces as blocks ----
    if (ch === '#' && next === '{') {
      if (!seenNonWS) { seenNonWS = true; selectorLine = line; }
      pos += 2; // skip  #{
      let depth = 1;
      while (pos < text.length && depth > 0) {
        if (text[pos] === '{') { depth++; }
        if (text[pos] === '}') { depth--; }
        if (text[pos] === '\n') { line++; }
        pos++;
      }
      continue;
    }

    // ---- track first non-WS for selector line ----
    if (!seenNonWS && ch !== ' ' && ch !== '\t' && ch !== '\r') {
      seenNonWS = true;
      selectorLine = line;
    }

    // ---- opening brace  { ----
    if (ch === '{') {
      const rawSelector = text.substring(selectorStart, pos).trim();
      const isAtRule = rawSelector.startsWith('@');

      if (isAtRule) {
        // @media, @supports, @keyframes, etc. → keep parent unchanged
        parentStack.push(parentStack[parentStack.length - 1]);
      } else if (rawSelector.length > 0) {
        const parents = parentStack[parentStack.length - 1];
        const parts = splitSelectors(rawSelector);
        const resolved: string[] = [];

        for (const sel of parts) {
          if (sel.includes('&')) {
            for (const parent of parents) {
              resolved.push(sel.replace(/&/g, parent));
            }
          } else {
            for (const parent of parents) {
              resolved.push(parent === '' ? sel : `${parent} ${sel}`);
            }
          }
        }

        for (const r of resolved) {
          results.push({ line: selectorLine, resolved: r, raw: rawSelector });
        }

        parentStack.push(resolved);
      } else {
        // empty selector (e.g. bare block in a mixin body) — keep parent
        parentStack.push(parentStack[parentStack.length - 1]);
      }

      pos++;
      resetSelector(pos);
      continue;
    }

    // ---- closing brace  } ----
    if (ch === '}') {
      if (parentStack.length > 1) { parentStack.pop(); }
      pos++;
      resetSelector(pos);
      continue;
    }

    // ---- semicolon  ;  (end of declaration / @-statement) ----
    if (ch === ';') {
      pos++;
      resetSelector(pos);
      continue;
    }

    pos++;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    'scssClassFinder.findClass',
    async () => {
      let cachedTarget = '';
      const config = vscode.workspace.getConfiguration('scssClassFinder');
      const previewOnResultFocus = config.get<boolean>('previewOnResultFocus', true);

      async function revealResult(result: SearchResult, preview: boolean) {
        const doc = await vscode.workspace.openTextDocument(result.uri);

        // Try to place the cursor on the selector token in its line.
        // Fallback to column 0 if no specific token is found.
        const lineText = doc.lineAt(result.line).text;
        const rawParts = splitSelectors(result.raw);
        let column = 0;
        let hasColumn = false;

        for (const part of rawParts) {
          const idx = lineText.indexOf(part);
          if (idx >= 0) {
            column = idx;
            hasColumn = true;
            break;
          }
        }

        if (!hasColumn && cachedTarget.length > 0) {
          const classWithoutDot = cachedTarget.startsWith('.')
            ? cachedTarget.slice(1)
            : cachedTarget;

          const directIdx = lineText.indexOf(classWithoutDot);
          if (directIdx >= 0) {
            column = directIdx;
            hasColumn = true;
          }
        }

        const pos = new vscode.Position(result.line, column);

        const ed = await vscode.window.showTextDocument(doc, {
          preview,
          preserveFocus: preview,
        });

        ed.selection = new vscode.Selection(pos, pos);
        ed.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.InCenter,
        );
      }

      // Pre-fill input with word under cursor (if any)
      const editor = vscode.window.activeTextEditor;
      let defaultValue = '';
      if (editor) {
        const range = editor.document.getWordRangeAtPosition(
          editor.selection.active,
          /[\w-]+/,
        );
        if (range) {
          defaultValue = editor.document.getText(range);
        }
      }

      const input = await vscode.window.showInputBox({
        prompt: 'SCSS class to find (resolved selector)',
        placeHolder: 'e.g. bodyCard-header',
        value: defaultValue,
      });

      if (!input) { return; }

      const target = input.startsWith('.') ? input : `.${input}`;
      cachedTarget = target;

      // Find all SCSS/SASS files in the workspace
      const files = await vscode.workspace.findFiles(
        '**/*.{scss,sass}',
        '**/{node_modules,dist,build,coverage}/**',
      );

      const results: SearchResult[] = [];

      for (const file of files) {
        const bytes = await vscode.workspace.fs.readFile(file);
        const text = Buffer.from(bytes).toString('utf8');
        const selectors = resolveSelectors(text);

        for (const sel of selectors) {
          let matchType: SearchResult['matchType'] | null = null;

          if (sel.resolved === target) {
            matchType = 'exact';
          } else if (sel.resolved.endsWith(target)) {
            matchType = 'endsWith';
          } else if (sel.resolved.includes(target)) {
            matchType = 'contains';
          }

          if (matchType) {
            results.push({
              uri: file,
              line: sel.line,
              resolved: sel.resolved,
              raw: sel.raw,
              matchType,
            });
          }
        }
      }

      if (results.length === 0) {
        vscode.window.showInformationMessage(`No matches found for "${target}"`);
        return;
      }

      // Sort: exact → endsWith → contains
      const order: Record<SearchResult['matchType'], number> = {
        exact: 0,
        endsWith: 1,
        contains: 2,
      };
      results.sort((a, b) => order[a.matchType] - order[b.matchType]);

      const iconFor = (t: SearchResult['matchType']) =>
        t === 'exact' ? '$(check)' : t === 'endsWith' ? '$(arrow-right)' : '$(search)';

      const items: QuickPickItemWithResult[] = results.map((r) => ({
        label: `${iconFor(r.matchType)} ${r.resolved}`,
        description: `${vscode.workspace.asRelativePath(r.uri)}:${r.line + 1}`,
        detail: `raw: ${r.raw}`,
        result: r,
      }));

      const picked = await new Promise<QuickPickItemWithResult | undefined>((resolve) => {
        const quickPick = vscode.window.createQuickPick<QuickPickItemWithResult>();
        let resolved = false;
        let previewToken = 0;

        const previewItem = (item: QuickPickItemWithResult | undefined) => {
          if (!previewOnResultFocus || !item) { return; }

          const token = ++previewToken;
          void revealResult(item.result, true).finally(() => {
            if (token !== previewToken) {
              return;
            }
          });
        };

        quickPick.items = items;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        quickPick.placeholder = `${results.length} result(s) for "${target}"`;

        const disposables: vscode.Disposable[] = [];

        disposables.push(
          quickPick.onDidChangeActive((activeItems) => {
            previewItem(activeItems[0]);
          }),
        );

        // Fallback for UI modes where selection changes are emitted more reliably.
        disposables.push(
          quickPick.onDidChangeSelection((selectedItems) => {
            previewItem(selectedItems[0]);
          }),
        );

        disposables.push(
          quickPick.onDidAccept(() => {
            resolved = true;
            resolve(quickPick.activeItems[0] ?? quickPick.selectedItems[0]);
            quickPick.hide();
          }),
        );

        disposables.push(
          quickPick.onDidHide(() => {
            if (!resolved) {
              resolve(undefined);
            }

            disposables.forEach((d) => d.dispose());
            quickPick.dispose();
          }),
        );

        quickPick.show();

        previewItem(items[0]);
      });

      if (!picked) { return; }

      await revealResult(picked.result, false);
    },
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
