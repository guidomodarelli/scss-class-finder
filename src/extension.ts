import * as vscode from 'vscode';
import * as path from 'path';
import { resolveSelectors, splitSelectors } from './selectorResolver';
import { parseSelectorToIR, getTargetClasses } from './selectorIR';
import { extractClassUsages, ExtractionResult } from './classExtractor';
import { matchSelectorChainMulti, MatchResult, MatchConfidence } from './structuralMatcher';

// ---------------------------------------------------------------------------
// .gitignore-aware file discovery
// ---------------------------------------------------------------------------

/**
 * Minimal .gitignore matcher — supports:
 *   - blank lines & comments (#)
 *   - negation (!) — tracked but not applied (conservative: we skip negated)
 *   - directory markers (trailing /)
 *   - leading / (root-relative)
 *   - wildcards: *, **, ?
 *   - character classes: [abc]
 *
 * Converts each pattern to a RegExp tested against the workspace-relative
 * POSIX path of the file.
 */
function parseGitignorePatterns(content: string): RegExp[] {
  const regexps: RegExp[] = [];

  for (let line of content.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) { continue; }
    // Skip negation patterns (conservative — don't un-ignore)
    if (line.startsWith('!')) { continue; }

    // Remove trailing spaces (unless escaped)
    line = line.replace(/(?<!\\)\s+$/, '');

    let pattern = line;
    let anchored = false;

    // Leading / means anchored to root
    if (pattern.startsWith('/')) {
      anchored = true;
      pattern = pattern.slice(1);
    }

    // Trailing / means directory only — for our purposes we match anything
    // under that directory, so append ** implicitly
    if (pattern.endsWith('/')) {
      pattern += '**';
    }

    // Escape regex special chars except our glob wildcards
    let regSrc = '';
    let i = 0;
    while (i < pattern.length) {
      const ch = pattern[i];
      if (ch === '*' && pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          regSrc += '(?:.+/)?';
          i += 3;
        } else {
          regSrc += '.*';
          i += 2;
        }
      } else if (ch === '*') {
        regSrc += '[^/]*';
        i++;
      } else if (ch === '?') {
        regSrc += '[^/]';
        i++;
      } else if (ch === '[') {
        const close = pattern.indexOf(']', i + 1);
        if (close >= 0) {
          regSrc += pattern.substring(i, close + 1);
          i = close + 1;
        } else {
          regSrc += '\\[';
          i++;
        }
      } else if ('.+^${}()|\\'.includes(ch)) {
        regSrc += '\\' + ch;
        i++;
      } else {
        regSrc += ch;
        i++;
      }
    }

    // If the pattern contains a slash (besides trailing) it's anchored
    if (pattern.includes('/')) {
      anchored = true;
    }

    if (anchored) {
      regexps.push(new RegExp('^' + regSrc + '(/.*)?$'));
    } else {
      // Unanchored: can match in any subdirectory
      regexps.push(new RegExp('(^|/)' + regSrc + '(/.*)?$'));
    }
  }

  return regexps;
}

interface GitignoreFilter {
  root: string;
  patterns: RegExp[];
}

async function loadGitignoreFilters(): Promise<GitignoreFilter[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const filters: GitignoreFilter[] = [];

  for (const folder of folders) {
    const gitignoreUri = vscode.Uri.joinPath(folder.uri, '.gitignore');
    try {
      const bytes = await vscode.workspace.fs.readFile(gitignoreUri);
      const content = Buffer.from(bytes).toString('utf8');
      const patterns = parseGitignorePatterns(content);
      if (patterns.length > 0) {
        filters.push({ root: folder.uri.fsPath, patterns });
      }
    } catch {
      // No .gitignore — skip
    }
  }

  return filters;
}

function isIgnoredByGitignore(uri: vscode.Uri, filters: GitignoreFilter[]): boolean {
  for (const filter of filters) {
    const rel = path.relative(filter.root, uri.fsPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { continue; }

    const posixRel = rel.split(path.sep).join('/');
    for (const re of filter.patterns) {
      if (re.test(posixRel)) { return true; }
    }
  }
  return false;
}

async function findWorkspaceFiles(includeGlob: string): Promise<vscode.Uri[]> {
  const files = await vscode.workspace.findFiles(
    includeGlob,
    '**/{node_modules,dist,build,coverage}/**',
  );

  const filters = await loadGitignoreFilters();
  if (filters.length === 0) { return files; }

  return files.filter((f) => !isIgnoredByGitignore(f, filters));
}

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
  const files = await findWorkspaceFiles('**/*.{scss,sass}');

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

  // ---------------------------------------------------------------------------
  // Template file extraction cache
  // ---------------------------------------------------------------------------

  const extractionCache = new Map<string, ExtractionResult>();

  function langFromUri(uri: vscode.Uri): 'html' | 'jsx' | 'tsx' | 'js' | 'ts' | null {
    const p = uri.fsPath;
    if (p.endsWith('.html') || p.endsWith('.htm')) { return 'html'; }
    if (p.endsWith('.jsx')) { return 'jsx'; }
    if (p.endsWith('.tsx')) { return 'tsx'; }
    if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) { return 'js'; }
    if (p.endsWith('.ts') || p.endsWith('.mts') || p.endsWith('.cts')) { return 'ts'; }
    return null;
  }

  async function getExtraction(uri: vscode.Uri): Promise<ExtractionResult | null> {
    const key = uri.toString();
    const cached = extractionCache.get(key);
    if (cached) { return cached; }

    const lang = langFromUri(uri);
    if (!lang) { return null; }

    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    const result = extractClassUsages(text, uri.fsPath, lang);
    extractionCache.set(key, result);
    return result;
  }

  async function getAllExtractions(): Promise<ExtractionResult[]> {
    const files = await findWorkspaceFiles('**/*.{js,jsx,ts,tsx,html,htm}');

    const results: ExtractionResult[] = [];
    for (const file of files) {
      const ext = await getExtraction(file);
      if (ext && ext.nodes.length > 0) {
        results.push(ext);
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Fallback: literal exact class token search
  // ---------------------------------------------------------------------------

  function isClassTokenChar(ch: string | undefined): boolean {
    return !!ch && /[A-Za-z0-9_-]/.test(ch);
  }

  function findExactClassTokenOffsets(text: string, token: string): number[] {
    if (!token) { return []; }

    const offsets: number[] = [];
    let from = 0;

    while (from < text.length) {
      const idx = text.indexOf(token, from);
      if (idx < 0) { break; }

      const prev = idx > 0 ? text[idx - 1] : undefined;
      const nextIdx = idx + token.length;
      const next = nextIdx < text.length ? text[nextIdx] : undefined;

      if (!isClassTokenChar(prev) && !isClassTokenChar(next)) {
        offsets.push(idx);
      }

      from = idx + token.length;
    }

    return offsets;
  }

  async function findLiteralClassTokenLocations(tokens: string[]): Promise<vscode.Location[]> {
    const uniqueTokens = Array.from(new Set(tokens.filter(Boolean)));
    if (uniqueTokens.length === 0) { return []; }

    const files = await findWorkspaceFiles('**/*.{js,jsx,ts,tsx,html,htm}');

    const dedup = new Map<string, vscode.Location>();

    for (const file of files) {
      const bytes = await vscode.workspace.fs.readFile(file);
      const text = Buffer.from(bytes).toString('utf8');

      for (const token of uniqueTokens) {
        const offsets = findExactClassTokenOffsets(text, token);
        for (const offset of offsets) {
          // Convert byte offset to line/column
          let line = 0;
          let lastNL = -1;
          for (let i = 0; i < offset && i < text.length; i++) {
            if (text[i] === '\n') { line++; lastNL = i; }
          }
          const col = offset - lastNL - 1;
          const pos = new vscode.Position(line, col);
          const key = `${file.toString()}:${line}:${col}`;
          if (!dedup.has(key)) {
            dedup.set(key, new vscode.Location(file, pos));
          }
        }
      }
    }

    return Array.from(dedup.values());
  }

  // Invalidate cache on file changes
  const templateWatcher = vscode.workspace.createFileSystemWatcher(
    '**/*.{js,jsx,ts,tsx,html,htm}',
  );
  templateWatcher.onDidChange((uri) => extractionCache.delete(uri.toString()));
  templateWatcher.onDidDelete((uri) => extractionCache.delete(uri.toString()));
  templateWatcher.onDidCreate(() => { /* new files are loaded on demand */ });
  context.subscriptions.push(templateWatcher);

  // ---------------------------------------------------------------------------
  // Helper: resolve selector under cursor in a style file
  // ---------------------------------------------------------------------------

  function resolveTargetSelector(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): string | null {
    const text = document.getText();
    const selectors = resolveSelectors(text);

    // Find the nearest selector to the current line
    let best: { resolved: string; distance: number } | null = null;

    for (const sel of selectors) {
      const distance = Math.abs(sel.line - position.line);
      if (best === null || distance < best.distance) {
        best = { resolved: sel.resolved, distance };
      }
    }

    // Also try to match a word under cursor as a class name
    const wordRange = document.getWordRangeAtPosition(position, /[\w-]+/);
    if (wordRange) {
      const word = document.getText(wordRange);
      // Check if any resolved selector contains this word as a class
      for (const sel of selectors) {
        if (sel.resolved.includes(`.${word}`) && sel.line === position.line) {
          return sel.resolved;
        }
      }
    }

    if (best && best.distance <= 2) {
      return best.resolved;
    }

    // Fallback: use word under cursor as simple class
    if (wordRange) {
      const word = document.getText(wordRange);
      if (word) { return `.${word}`; }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Reverse DefinitionProvider: Go from SCSS/CSS → usage in JS/TS/HTML
  // ---------------------------------------------------------------------------

  const reverseDefinitionProvider = vscode.languages.registerDefinitionProvider(
    [
      { language: 'scss' },
      { language: 'sass' },
      { language: 'css' },
    ],
    {
      async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
      ): Promise<vscode.Location[] | null> {
        const selector = resolveTargetSelector(document, position);
        if (!selector) { return null; }

        const chain = parseSelectorToIR(selector);
        const targetClasses = getTargetClasses(chain);
        if (targetClasses.length === 0) { return null; }

        const extractions = await getAllExtractions();
        const matches = matchSelectorChainMulti(chain, extractions);

        if (matches.length === 0) {
          // Fallback: exact literal class token search when structural matching
          // found nothing (e.g. class used in a dynamic expression or plain string).
          const fallbackLocations = await findLiteralClassTokenLocations(targetClasses);
          return fallbackLocations.length > 0 ? fallbackLocations : null;
        }

        return matches.map((m) => {
          const uri = vscode.Uri.file(m.filePath);
          return new vscode.Location(uri, new vscode.Position(m.line, m.column));
        });
      },
    },
  );

  context.subscriptions.push(reverseDefinitionProvider);

  // ---------------------------------------------------------------------------
  // Reverse ReferenceProvider: Find all usages of a class from SCSS/CSS
  // ---------------------------------------------------------------------------

  const reverseReferenceProvider = vscode.languages.registerReferenceProvider(
    [
      { language: 'scss' },
      { language: 'sass' },
      { language: 'css' },
    ],
    {
      async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
      ): Promise<vscode.Location[] | null> {
        const selector = resolveTargetSelector(document, position);
        if (!selector) { return null; }

        const chain = parseSelectorToIR(selector);
        const targetClasses = getTargetClasses(chain);
        if (targetClasses.length === 0) { return null; }

        const extractions = await getAllExtractions();
        const matches = matchSelectorChainMulti(chain, extractions);

        if (matches.length === 0) { return null; }

        return matches.map((m) => {
          const uri = vscode.Uri.file(m.filePath);
          return new vscode.Location(uri, new vscode.Position(m.line, m.column));
        });
      },
    },
  );

  context.subscriptions.push(reverseReferenceProvider);

  // ---------------------------------------------------------------------------
  // Command: Find Class Usages (reverse search with QuickPick)
  // ---------------------------------------------------------------------------

  const findUsagesCmd = vscode.commands.registerCommand(
    'scssClassFinder.findClassUsages',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const selector = resolveTargetSelector(editor.document, editor.selection.active);
      if (!selector) {
        vscode.window.showInformationMessage('No CSS selector found at cursor position');
        return;
      }

      const chain = parseSelectorToIR(selector);
      const targetClasses = getTargetClasses(chain);
      if (targetClasses.length === 0) {
        vscode.window.showInformationMessage('No class names found in selector');
        return;
      }

      const extractions = await getAllExtractions();
      const matches = matchSelectorChainMulti(chain, extractions);

      if (matches.length === 0) {
        vscode.window.showInformationMessage(`No usages found for "${selector}"`);
        return;
      }

      const iconFor = (c: MatchConfidence) => {
        switch (c) {
          case 'exact': return '$(check)';
          case 'structural': return '$(symbol-structure)';
          case 'partial': return '$(symbol-event)';
          case 'probable': return '$(question)';
        }
      };

      interface UsageQuickPickItem extends vscode.QuickPickItem {
        match: MatchResult;
      }

      const items: UsageQuickPickItem[] = matches.map((m) => ({
        label: `${iconFor(m.confidence)} ${m.confidence}`,
        description: `${vscode.workspace.asRelativePath(m.filePath)}:${m.line + 1}`,
        detail: m.reason,
        match: m,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `${matches.length} usage(s) of "${selector}"`,
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!picked) { return; }

      const uri = vscode.Uri.file(picked.match.filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const pos = new vscode.Position(picked.match.line, picked.match.column);
      const ed = await vscode.window.showTextDocument(doc);
      ed.selection = new vscode.Selection(pos, pos);
      ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    },
  );

  context.subscriptions.push(findUsagesCmd);
}

export function deactivate() {}
