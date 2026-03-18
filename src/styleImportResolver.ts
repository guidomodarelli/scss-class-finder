import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface StyleImportReference {
  directive: 'import' | 'use' | 'forward';
  importPath: string;
  contentStart: number;
  contentEnd: number;
}

interface ModuleAliasesConfig {
  packageJsonPath: string;
  packageJsonDir: string;
  aliases: Record<string, string>;
}

export interface ResolveStyleImportDefinitionOptions {
  documentPath: string;
  workspaceFolderPath?: string;
  importPath: string;
}

export function findStyleImportReferenceAtPosition(
  lineText: string,
  column: number,
): StyleImportReference | null {
  const directiveMatch = lineText.match(/^\s*@(import|use|forward)\b/);
  if (!directiveMatch) {
    return null;
  }

  const directive = directiveMatch[1] as StyleImportReference['directive'];
  let activeQuote: '"' | '\'' | null = null;
  let contentStart = -1;

  for (let index = directiveMatch[0].length; index < lineText.length; index++) {
    const char = lineText[index];
    const prevChar = index > 0 ? lineText[index - 1] : '';

    if (activeQuote) {
      if (char === activeQuote && prevChar !== '\\') {
        const contentEnd = index;
        if (column >= contentStart && column < contentEnd) {
          return {
            directive,
            importPath: lineText.slice(contentStart, contentEnd),
            contentStart,
            contentEnd,
          };
        }
        activeQuote = null;
        contentStart = -1;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      activeQuote = char;
      contentStart = index + 1;
    }
  }

  return null;
}

export function getStyleImportCandidatePaths(resolvedImportPath: string): string[] {
  const existingExtension = path.extname(resolvedImportPath);
  if (existingExtension) {
    return [resolvedImportPath];
  }

  return [
    `${resolvedImportPath}.scss`,
    `${resolvedImportPath}.sass`,
    `${resolvedImportPath}.css`,
  ];
}

export async function loadNearestModuleAliases(
  documentPath: string,
  workspaceFolderPath?: string,
): Promise<ModuleAliasesConfig | null> {
  const searchStartDir = path.dirname(documentPath);
  const searchDirs = getPackageSearchDirectories(searchStartDir, workspaceFolderPath);

  for (const directoryPath of searchDirs) {
    const packageJsonPath = path.join(directoryPath, 'package.json');
    const aliases = await loadModuleAliasesFromPackageJson(packageJsonPath);
    if (aliases) {
      return {
        packageJsonPath,
        packageJsonDir: directoryPath,
        aliases,
      };
    }
  }

  return null;
}

export async function resolveStyleImportDefinition(
  options: ResolveStyleImportDefinitionOptions,
): Promise<string | null> {
  const aliasesConfig = await loadNearestModuleAliases(
    options.documentPath,
    options.workspaceFolderPath,
  );
  if (!aliasesConfig) {
    return null;
  }

  const resolvedImportBasePath = resolveAliasedImportPath(
    options.importPath,
    aliasesConfig.aliases,
    aliasesConfig.packageJsonDir,
  );
  if (!resolvedImportBasePath) {
    return null;
  }

  const candidatePaths = getStyleImportCandidatePaths(resolvedImportBasePath);
  for (const candidatePath of candidatePaths) {
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function getPackageSearchDirectories(
  searchStartDir: string,
  workspaceFolderPath?: string,
): string[] {
  const directories: string[] = [];
  const normalizedWorkspaceFolderPath = workspaceFolderPath
    ? path.resolve(workspaceFolderPath)
    : null;

  let currentDir = path.resolve(searchStartDir);

  while (true) {
    directories.push(currentDir);

    if (normalizedWorkspaceFolderPath && currentDir === normalizedWorkspaceFolderPath) {
      break;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  if (
    normalizedWorkspaceFolderPath
    && !directories.includes(normalizedWorkspaceFolderPath)
  ) {
    directories.push(normalizedWorkspaceFolderPath);
  }

  return directories;
}

async function loadModuleAliasesFromPackageJson(
  packageJsonPath: string,
): Promise<Record<string, string> | null> {
  let rawPackageJson: string;

  try {
    rawPackageJson = await fs.readFile(packageJsonPath, 'utf8');
  } catch {
    return null;
  }

  let parsedPackageJson: unknown;
  try {
    parsedPackageJson = JSON.parse(rawPackageJson);
  } catch {
    return null;
  }

  if (!parsedPackageJson || typeof parsedPackageJson !== 'object') {
    return null;
  }

  const moduleAliasesValue = (parsedPackageJson as { _moduleAliases?: unknown })._moduleAliases;
  if (!moduleAliasesValue || typeof moduleAliasesValue !== 'object') {
    return null;
  }

  const aliases: Record<string, string> = {};
  for (const [aliasName, aliasValue] of Object.entries(moduleAliasesValue)) {
    if (typeof aliasValue === 'string') {
      aliases[aliasName] = aliasValue;
    }
  }

  return Object.keys(aliases).length > 0 ? aliases : null;
}

function resolveAliasedImportPath(
  importPath: string,
  aliases: Record<string, string>,
  packageJsonDir: string,
): string | null {
  const normalizedImportPath = importPath.startsWith('~')
    ? importPath.slice(1)
    : importPath;

  const aliasNames = Object.keys(aliases).sort((leftAlias, rightAlias) =>
    rightAlias.length - leftAlias.length,
  );

  for (const aliasName of aliasNames) {
    if (
      normalizedImportPath !== aliasName
      && !normalizedImportPath.startsWith(`${aliasName}/`)
    ) {
      continue;
    }

    const aliasTarget = aliases[aliasName];
    const importSuffix = normalizedImportPath.slice(aliasName.length).replace(/^\/+/, '');
    const aliasBasePath = path.resolve(packageJsonDir, aliasTarget);
    return importSuffix.length > 0
      ? path.resolve(aliasBasePath, importSuffix)
      : aliasBasePath;
  }

  return null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await fs.stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}
