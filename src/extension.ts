import * as vscode from 'vscode';
import { resolveSelectors, splitSelectors } from './selectorResolver';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchResult {
  uri: vscode.Uri;
  line: number;
  resolved: string;
  raw: string;
  matchType: 'exact' | 'pseudoSuffix' | 'endsWith';
}

interface QuickPickItemWithResult extends vscode.QuickPickItem {
  result: SearchResult;
}

interface FindClassCommandOptions {
  query?: string;
  autoPickFirst?: boolean;
  previewOnResultFocus?: boolean;
  suppressNoResultsMessage?: boolean;
}

// ---------------------------------------------------------------------------
// Shared search logic
// ---------------------------------------------------------------------------

async function findMatchingSelectors(target: string): Promise<SearchResult[]> {
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
      } else if (
        sel.resolved.startsWith(`${target}:`) ||
        sel.resolved.startsWith(`${target}[`)
      ) {
        matchType = 'pseudoSuffix';
      } else if (sel.resolved.endsWith(` ${target}`)) {
        matchType = 'endsWith';
      } else if (
        sel.resolved.includes(` ${target}:`) ||
        sel.resolved.includes(` ${target}[`)
      ) {
        matchType = 'endsWith';
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

  const order: Record<SearchResult['matchType'], number> = {
    exact: 0,
    pseudoSuffix: 1,
    endsWith: 2,
  };
  results.sort((a, b) => order[a.matchType] - order[b.matchType]);

  return results;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
  // --- Command: Find Class by Resolved Selector ---
  const disposable = vscode.commands.registerCommand(
    'scssClassFinder.findClass',
    async (options?: FindClassCommandOptions) => {
      let cachedTarget = '';
      const config = vscode.workspace.getConfiguration('scssClassFinder');
      const previewOnResultFocus = options?.previewOnResultFocus
        ?? config.get<boolean>('previewOnResultFocus', true);

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

      const input = options?.query && options.query.trim().length > 0
        ? options.query.trim()
        : await vscode.window.showInputBox({
          prompt: 'SCSS class to find (resolved selector)',
          placeHolder: 'e.g. bodyCard-header',
          value: defaultValue,
        });

      if (!input) { return; }

      const target = input.startsWith('.') ? input : `.${input}`;
      cachedTarget = target;

      const results = await findMatchingSelectors(target);

      if (results.length === 0) {
        if (!options?.suppressNoResultsMessage) {
          vscode.window.showInformationMessage(`No matches found for "${target}"`);
        }
        return;
      }

      const iconFor = (t: SearchResult['matchType']) =>
        t === 'exact' ? '$(check)' : t === 'pseudoSuffix' ? '$(symbol-event)' : '$(arrow-right)';

      const items: QuickPickItemWithResult[] = results.map((r) => ({
        label: `${iconFor(r.matchType)} ${r.resolved}`,
        description: `${vscode.workspace.asRelativePath(r.uri)}:${r.line + 1}`,
        detail: `raw: ${r.raw}`,
        result: r,
      }));

      if (options?.autoPickFirst) {
        await revealResult(items[0].result, false);
        return;
      }

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

  // --- DefinitionProvider: Go to SCSS definition from JS/TS/HTML ---
  const definitionProvider = vscode.languages.registerDefinitionProvider(
    [
      { language: 'javascript' },
      { language: 'javascriptreact' },
      { language: 'typescript' },
      { language: 'typescriptreact' },
      { language: 'html' },
    ],
    {
      async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
      ): Promise<vscode.Location[] | null> {
        const range = document.getWordRangeAtPosition(position, /[\w-]+/);
        if (!range) { return null; }

        const word = document.getText(range);
        if (!word) { return null; }

        const target = `.${word}`;
        const results = await findMatchingSelectors(target);

        if (results.length === 0) { return null; }

        return results.map((r) => new vscode.Location(r.uri, new vscode.Position(r.line, 0)));
      },
    },
  );

  context.subscriptions.push(definitionProvider);
}

export function deactivate() {}
