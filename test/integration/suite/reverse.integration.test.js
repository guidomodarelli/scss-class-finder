const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  // Ensure the extension is active
  const extension = vscode.extensions.all.find(
    (ext) => ext.packageJSON && ext.packageJSON.name === 'scss-class-finder',
  );
  assert.ok(extension, 'Expected extension scss-class-finder to be loaded');
  await extension.activate();

  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

  // --- Reverse navigation: from SCSS class to JSX/HTML usage ---
  // Position cursor on "card-header" class in SCSS and verify Go to Definition
  // finds it in the JSX and HTML files.
  {
    const scssUri = vscode.Uri.file(
      path.join(workspaceRoot, 'styles', 'sample.scss'),
    );
    const doc = await vscode.workspace.openTextDocument(scssUri);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    // Find "&-header" in the SCSS (line with the nested selector)
    const headerIdx = text.indexOf('&-header');
    assert.ok(headerIdx >= 0, 'Expected to find "&-header" in SCSS fixture');
    const pos = doc.positionAt(headerIdx + 2); // position on "header" word

    const locations = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      scssUri,
      pos,
    );

    assert.ok(
      locations && locations.length > 0,
      'Expected at least one reverse definition for "card-header" from SCSS → usage in code',
    );

    // Verify at least one result points to JSX or HTML
    const hasCodeTarget = locations.some((loc) => {
      const fp = loc.uri.fsPath;
      return fp.endsWith('.jsx') || fp.endsWith('.tsx') || fp.endsWith('.html');
    });
    assert.ok(
      hasCodeTarget,
      `Expected reverse definition to point to JSX/HTML, got: ${locations.map((l) => l.uri.fsPath).join(', ')}`,
    );
  }

  // --- Ignore import paths in style at-rules ---
  {
    const scssUri = vscode.Uri.file(
      path.join(workspaceRoot, 'styles', 'sample.scss'),
    );
    const doc = await vscode.workspace.openTextDocument(scssUri);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    const importPathIdx = text.indexOf('Search/styles');
    assert.ok(importPathIdx >= 0, 'Expected to find import path in SCSS fixture');
    const pos = doc.positionAt(importPathIdx + 'Search/'.length + 1); // position on "styles"

    const locations = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      scssUri,
      pos,
    );

    assert.ok(
      !locations || locations.length === 0,
      `Expected no reverse definition results from import path, got: ${(locations ?? []).map((loc) => loc.uri.fsPath).join(', ')}`,
    );
  }

  // --- Verify the findClassUsages command is registered ---
  {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('scssClassFinder.findClassUsages'),
      'Expected scssClassFinder.findClassUsages to be registered',
    );
  }

  // --- Verify .btn resolves to usages in JSX ---
  {
    const scssUri = vscode.Uri.file(
      path.join(workspaceRoot, 'styles', 'sample.scss'),
    );
    const doc = await vscode.workspace.openTextDocument(scssUri);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    const btnIdx = text.indexOf('.btn');
    assert.ok(btnIdx >= 0, 'Expected to find ".btn" in SCSS fixture');
    const pos = doc.positionAt(btnIdx + 1); // position on "btn"

    const locations = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      scssUri,
      pos,
    );

    assert.ok(
      locations && locations.length > 0,
      'Expected at least one reverse definition for ".btn" from SCSS',
    );
  }

  // --- Literal fallback: structural match empty → exact token search ---
  {
    const scssUri = vscode.Uri.file(
      path.join(workspaceRoot, 'styles', 'sample.scss'),
    );
    const doc = await vscode.workspace.openTextDocument(scssUri);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    const literalIdx = text.indexOf('.literal-only');
    assert.ok(literalIdx >= 0, 'Expected to find ".literal-only" in SCSS fixture');
    const pos = doc.positionAt(literalIdx + 1); // position on "literal-only"

    const locations = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      scssUri,
      pos,
    );

    assert.ok(
      locations && locations.length > 0,
      'Expected reverse definition fallback results for ".literal-only"',
    );

    const hasSampleTarget = locations.some((loc) =>
      loc.uri.fsPath.endsWith(path.join('components', 'Sample.jsx')),
    );

    assert.ok(
      hasSampleTarget,
      'Expected at least one fallback location in components/Sample.jsx',
    );
  }
}

module.exports = { run };
