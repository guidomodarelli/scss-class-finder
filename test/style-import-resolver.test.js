const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  findStyleImportReferenceAtPosition,
  getStyleImportCandidatePaths,
  loadNearestModuleAliases,
  resolveStyleImportDefinition,
} = require('../out/styleImportResolver.js');

test('findStyleImportReferenceAtPosition: detects @import path under cursor', () => {
  const lineText = '@import \'~@root/app/components/Settings/styles\';';
  const column = lineText.indexOf('Settings');

  const reference = findStyleImportReferenceAtPosition(lineText, column);

  assert.deepEqual(reference, {
    directive: 'import',
    importPath: '~@root/app/components/Settings/styles',
    contentStart: lineText.indexOf('~@root'),
    contentEnd: lineText.lastIndexOf('\''),
  });
});

test('findStyleImportReferenceAtPosition: supports @use and @forward', () => {
  const useLineText = '@use "@root/app/components/Typography/styles" as *;';
  const forwardLineText = '@forward \'@root/app/components/Theme/styles\';';

  const useReference = findStyleImportReferenceAtPosition(
    useLineText,
    useLineText.indexOf('Typography'),
  );
  const forwardReference = findStyleImportReferenceAtPosition(
    forwardLineText,
    forwardLineText.indexOf('Theme'),
  );

  assert.equal(useReference?.directive, 'use');
  assert.equal(useReference?.importPath, '@root/app/components/Typography/styles');
  assert.equal(forwardReference?.directive, 'forward');
  assert.equal(forwardReference?.importPath, '@root/app/components/Theme/styles');
});

test('findStyleImportReferenceAtPosition: returns null outside the import string', () => {
  const lineText = '@import \'~@root/app/components/Settings/styles\';';
  const column = lineText.indexOf('@import');

  const reference = findStyleImportReferenceAtPosition(lineText, column);

  assert.equal(reference, null);
});

test('getStyleImportCandidatePaths: prefers scss, then sass, then css', () => {
  assert.deepEqual(
    getStyleImportCandidatePaths('/tmp/styles'),
    ['/tmp/styles.scss', '/tmp/styles.sass', '/tmp/styles.css'],
  );
});

test('getStyleImportCandidatePaths: keeps explicit extensions untouched', () => {
  assert.deepEqual(
    getStyleImportCandidatePaths('/tmp/styles.scss'),
    ['/tmp/styles.scss'],
  );
});

test('loadNearestModuleAliases: loads aliases from the closest package.json', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scss-class-finder-'));
  const appRoot = path.join(tempRoot, 'workspace');
  const nestedDir = path.join(appRoot, 'app', 'components', 'Settings');
  fs.mkdirSync(nestedDir, { recursive: true });

  fs.writeFileSync(
    path.join(appRoot, 'package.json'),
    JSON.stringify({
      _moduleAliases: {
        '@root': '.',
      },
    }),
  );

  const aliasesConfig = await loadNearestModuleAliases(
    path.join(nestedDir, 'styles.scss'),
    appRoot,
  );

  assert.equal(aliasesConfig?.packageJsonPath, path.join(appRoot, 'package.json'));
  assert.deepEqual(aliasesConfig?.aliases, { '@root': '.' });
});

test('resolveStyleImportDefinition: resolves aliases relative to package.json directory', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scss-class-finder-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const documentDir = path.join(workspaceRoot, 'styles');
  const targetDir = path.join(workspaceRoot, 'app', 'components', 'Settings');
  fs.mkdirSync(documentDir, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });

  fs.writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({
      _moduleAliases: {
        '@root': '.',
      },
    }),
  );
  fs.writeFileSync(path.join(targetDir, 'styles.scss'), '.settings { color: red; }');

  const resolvedPath = await resolveStyleImportDefinition({
    documentPath: path.join(documentDir, 'sample.scss'),
    workspaceFolderPath: workspaceRoot,
    importPath: '~@root/app/components/Settings/styles',
  });

  assert.equal(resolvedPath, path.join(targetDir, 'styles.scss'));
});

test('resolveStyleImportDefinition: falls back from scss to sass to css', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scss-class-finder-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const documentDir = path.join(workspaceRoot, 'styles');
  const targetDir = path.join(workspaceRoot, 'app', 'components', 'Theme');
  fs.mkdirSync(documentDir, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });

  fs.writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({
      _moduleAliases: {
        '@root': '.',
      },
    }),
  );
  fs.writeFileSync(path.join(targetDir, 'styles.css'), '.theme { color: blue; }');

  const resolvedPath = await resolveStyleImportDefinition({
    documentPath: path.join(documentDir, 'sample.scss'),
    workspaceFolderPath: workspaceRoot,
    importPath: '@root/app/components/Theme/styles',
  });

  assert.equal(resolvedPath, path.join(targetDir, 'styles.css'));
});

test('resolveStyleImportDefinition: returns null for unknown aliases', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scss-class-finder-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const documentDir = path.join(workspaceRoot, 'styles');
  fs.mkdirSync(documentDir, { recursive: true });

  fs.writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({
      _moduleAliases: {
        '@root': '.',
      },
    }),
  );

  const resolvedPath = await resolveStyleImportDefinition({
    documentPath: path.join(documentDir, 'sample.scss'),
    workspaceFolderPath: workspaceRoot,
    importPath: '~@missing/app/components/Settings/styles',
  });

  assert.equal(resolvedPath, null);
});
