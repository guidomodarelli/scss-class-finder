import * as vscode from 'vscode';
import * as path from 'path';
import { resolveSelectors, splitSelectors } from './selectorResolver';
import { parseSelectorToIR, getTargetClasses } from './selectorIR';
import { extractClassUsages, ExtractionResult } from './classExtractor';
import {
  findClassTokenAtOffset,
  findSassVariableAtOffset,
  isClassTokenCharacter,
} from './classToken';
import { matchSelectorChainMulti, MatchResult, MatchConfidence } from './structuralMatcher';
import {
  findStyleImportReferenceAtPosition,
  resolveStyleImportDefinition,
} from './styleImportResolver';

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

function createContextualError(message: string, cause: unknown): Error {
  const contextualError = new Error(message);
  Object.assign(contextualError, { cause });
  return contextualError;
}

function isMissingFileError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('FileNotFound') || error.message.includes('EntryNotFound');
}

async function readWorkspaceTextFile(uri: vscode.Uri, operationName: string): Promise<string> {
  try {
    const fileBytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(fileBytes).toString('utf8');
  } catch (error) {
    throw createContextualError(
      `readWorkspaceTextFile failed during ${operationName} for uri="${uri.toString()}"`,
      error,
    );
  }
}

async function tryLoadGitignoreFilter(folder: vscode.WorkspaceFolder): Promise<GitignoreFilter | null> {
  const gitignoreUri = vscode.Uri.joinPath(folder.uri, '.gitignore');

  try {
    const gitignoreContent = await readWorkspaceTextFile(
      gitignoreUri,
      `loadGitignoreFilters:readGitignore workspaceFolder="${folder.uri.fsPath}"`,
    );
    const patterns = parseGitignorePatterns(gitignoreContent);
    if (patterns.length === 0) {
      return null;
    }

    return { root: folder.uri.fsPath, patterns };
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw createContextualError(
      `loadGitignoreFilters failed for workspaceFolder="${folder.uri.fsPath}" while reading ".gitignore"`,
      error,
    );
  }
}

async function loadGitignoreFilters(): Promise<GitignoreFilter[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const filters: GitignoreFilter[] = [];

  for (const folder of workspaceFolders) {
    const filter = await tryLoadGitignoreFilter(folder);
    if (filter) {
      filters.push(filter);
    }
  }

  return filters;
}

function isIgnoredByGitignore(uri: vscode.Uri, filters: GitignoreFilter[]): boolean {
  for (const filter of filters) {
    const relativePath = path.relative(filter.root, uri.fsPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) { continue; }

    const posixRelativePath = relativePath.split(path.sep).join('/');
    for (const pattern of filter.patterns) {
      if (pattern.test(posixRelativePath)) { return true; }
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

  return files.filter((fileUri) => !isIgnoredByGitignore(fileUri, filters));
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

function getClassTokenAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
): { value: string; range: vscode.Range } | null {
  const text = document.getText();
  const tokenMatch = findClassTokenAtOffset(text, document.offsetAt(position));
  if (!tokenMatch) {
    return null;
  }

  return {
    value: tokenMatch.value,
    range: new vscode.Range(
      document.positionAt(tokenMatch.start),
      document.positionAt(tokenMatch.end),
    ),
  };
}

function isSassVariableAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
): boolean {
  const text = document.getText();
  return findSassVariableAtOffset(text, document.offsetAt(position)) !== null;
}

// ---------------------------------------------------------------------------
// Shared search logic
// ---------------------------------------------------------------------------

async function findMatchingSelectors(target: string): Promise<SearchResult[]> {
  const files = await findWorkspaceFiles('**/*.{scss,sass}');

  const results: SearchResult[] = [];

  for (const file of files) {
    const text = await readWorkspaceTextFile(
      file,
      `findMatchingSelectors:readStyleFile target="${target}"`,
    );
    const selectors = resolveSelectors(text);

    for (const selectorInfo of selectors) {
      let matchType: SearchResult['matchType'] | null = null;

      if (selectorInfo.resolved === target) {
        matchType = 'exact';
      } else if (
        selectorInfo.resolved.startsWith(`${target}:`) ||
        selectorInfo.resolved.startsWith(`${target}[`)
      ) {
        matchType = 'pseudoSuffix';
      } else if (selectorInfo.resolved.endsWith(` ${target}`)) {
        matchType = 'endsWith';
      } else if (
        selectorInfo.resolved.includes(` ${target}:`) ||
        selectorInfo.resolved.includes(` ${target}[`)
      ) {
        matchType = 'endsWith';
      }

      if (matchType) {
        results.push({
          uri: file,
          line: selectorInfo.line,
          resolved: selectorInfo.resolved,
          raw: selectorInfo.raw,
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
        const document = await vscode.workspace.openTextDocument(result.uri);

        // Try to place the cursor on the selector token in its line.
        // Fallback to column 0 if no specific token is found.
        const lineText = document.lineAt(result.line).text;
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

        const position = new vscode.Position(result.line, column);

        const editor = await vscode.window.showTextDocument(document, {
          preview,
          preserveFocus: preview,
        });

        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter,
        );
      }

      // Pre-fill input with word under cursor (if any)
      const editor = vscode.window.activeTextEditor;
      let defaultValue = '';
      if (editor) {
        const classToken = getClassTokenAtPosition(editor.document, editor.selection.active);
        if (classToken) {
          defaultValue = classToken.value;
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

      const items: QuickPickItemWithResult[] = results.map((searchResult) => ({
        label: `${iconFor(searchResult.matchType)} ${searchResult.resolved}`,
        description: `${vscode.workspace.asRelativePath(searchResult.uri)}:${searchResult.line + 1}`,
        detail: `raw: ${searchResult.raw}`,
        result: searchResult,
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

            disposables.forEach((subscription) => subscription.dispose());
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
      ): Promise<vscode.DefinitionLink[] | null> {
        const classToken = getClassTokenAtPosition(document, position);
        if (!classToken) { return null; }

        const target = `.${classToken.value}`;
        const results = await findMatchingSelectors(target);

        if (results.length === 0) { return null; }

        return results.map((result) => {
          const targetPosition = new vscode.Position(result.line, 0);

          return {
            originSelectionRange: classToken.range,
            targetUri: result.uri,
            targetRange: new vscode.Range(targetPosition, targetPosition),
            targetSelectionRange: new vscode.Range(targetPosition, targetPosition),
          };
        });
      },
    },
  );

  context.subscriptions.push(definitionProvider);

  // ---------------------------------------------------------------------------
  // Template file extraction cache
  // ---------------------------------------------------------------------------

  const extractionCache = new Map<string, ExtractionResult>();

  function langFromUri(uri: vscode.Uri): 'html' | 'jsx' | 'tsx' | 'js' | 'ts' | null {
    const filePath = uri.fsPath;
    if (filePath.endsWith('.html') || filePath.endsWith('.htm')) { return 'html'; }
    if (filePath.endsWith('.jsx')) { return 'jsx'; }
    if (filePath.endsWith('.tsx')) { return 'tsx'; }
    if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) { return 'js'; }
    if (filePath.endsWith('.ts') || filePath.endsWith('.mts') || filePath.endsWith('.cts')) { return 'ts'; }
    return null;
  }

  async function getExtraction(uri: vscode.Uri): Promise<ExtractionResult | null> {
    const key = uri.toString();
    const cached = extractionCache.get(key);
    if (cached) { return cached; }

    const lang = langFromUri(uri);
    if (!lang) { return null; }

    const text = await readWorkspaceTextFile(
      uri,
      `getExtraction:readTemplateFile uri="${uri.toString()}"`,
    );
    const result = extractClassUsages(text, uri.fsPath, lang);
    extractionCache.set(key, result);
    return result;
  }

  async function getAllExtractions(): Promise<ExtractionResult[]> {
    const files = await findWorkspaceFiles('**/*.{js,jsx,ts,tsx,html,htm}');

    const results: ExtractionResult[] = [];
    for (const file of files) {
      const extractionResult = await getExtraction(file);
      if (extractionResult && extractionResult.nodes.length > 0) {
        results.push(extractionResult);
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Fallback: literal exact class token search
  // ---------------------------------------------------------------------------

  function isClassTokenChar(ch: string | undefined): boolean {
    return isClassTokenCharacter(ch);
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
      const text = await readWorkspaceTextFile(
        file,
        `findLiteralClassTokenLocations:readTemplateFile uri="${file.toString()}"`,
      );

      for (const token of uniqueTokens) {
        const offsets = findExactClassTokenOffsets(text, token);
        for (const offset of offsets) {
          // Convert byte offset to line/column
          let line = 0;
          let lastNL = -1;
          for (let i = 0; i < offset && i < text.length; i++) {
            if (text[i] === '\n') { line++; lastNL = i; }
          }
          const column = offset - lastNL - 1;
          const position = new vscode.Position(line, column);
          const key = `${file.toString()}:${line}:${column}`;
          if (!dedup.has(key)) {
            dedup.set(key, new vscode.Location(file, position));
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
    if (isSassVariableAtPosition(document, position)) {
      return null;
    }

    const lineText = document.lineAt(position.line).text;
    if (findStyleImportReferenceAtPosition(lineText, position.character)) {
      return null;
    }

    const text = document.getText();
    const selectors = resolveSelectors(text);

    // Find the nearest selector to the current line
    let best: { resolved: string; distance: number } | null = null;

    for (const selectorInfo of selectors) {
      const distance = Math.abs(selectorInfo.line - position.line);
      if (best === null || distance < best.distance) {
        best = { resolved: selectorInfo.resolved, distance };
      }
    }

    // Also try to match a word under cursor as a class name
    const classToken = getClassTokenAtPosition(document, position);
    if (classToken) {
      const word = classToken.value;
      // Check if any resolved selector contains this word as a class
      for (const selectorInfo of selectors) {
        if (selectorInfo.resolved.includes(`.${word}`) && selectorInfo.line === position.line) {
          return selectorInfo.resolved;
        }
      }
    }

    if (best && best.distance <= 2) {
      return best.resolved;
    }

    // Fallback: use word under cursor as simple class
    if (classToken) {
      const word = classToken.value;
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
      ): Promise<vscode.Location[] | vscode.DefinitionLink[] | null> {
        const lineText = document.lineAt(position.line).text;
        const styleImportReference = findStyleImportReferenceAtPosition(
          lineText,
          position.character,
        );
        if (styleImportReference) {
          const workspaceFolderPath = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
          const resolvedImportPath = await resolveStyleImportDefinition({
            documentPath: document.uri.fsPath,
            workspaceFolderPath,
            importPath: styleImportReference.importPath,
          });
          if (!resolvedImportPath) { return null; }

          const originSelectionRange = new vscode.Range(
            new vscode.Position(position.line, styleImportReference.contentStart),
            new vscode.Position(position.line, styleImportReference.contentEnd),
          );
          const targetPosition = new vscode.Position(0, 0);

          return [
            {
              originSelectionRange,
              targetUri: vscode.Uri.file(resolvedImportPath),
              targetRange: new vscode.Range(targetPosition, targetPosition),
              targetSelectionRange: new vscode.Range(targetPosition, targetPosition),
            },
          ];
        }

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

        return matches.map((matchResult) => {
          const uri = vscode.Uri.file(matchResult.filePath);
          return new vscode.Location(uri, new vscode.Position(matchResult.line, matchResult.column));
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

        return matches.map((matchResult) => {
          const uri = vscode.Uri.file(matchResult.filePath);
          return new vscode.Location(uri, new vscode.Position(matchResult.line, matchResult.column));
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
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) { return; }

      const selector = resolveTargetSelector(activeEditor.document, activeEditor.selection.active);
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

      const items: UsageQuickPickItem[] = matches.map((matchResult) => ({
        label: `${iconFor(matchResult.confidence)} ${matchResult.confidence}`,
        description: `${vscode.workspace.asRelativePath(matchResult.filePath)}:${matchResult.line + 1}`,
        detail: matchResult.reason,
        match: matchResult,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `${matches.length} usage(s) of "${selector}"`,
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!picked) { return; }

      const uri = vscode.Uri.file(picked.match.filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const position = new vscode.Position(picked.match.line, picked.match.column);
      const revealedEditor = await vscode.window.showTextDocument(document);
      revealedEditor.selection = new vscode.Selection(position, position);
      revealedEditor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    },
  );

  context.subscriptions.push(findUsagesCmd);
}

export function deactivate() {}
