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

  // --- Exact match: "card-header" in JSX → .card-header in SCSS ---
  {
    const jsxUri = vscode.Uri.file(
      path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'components', 'Sample.jsx'),
    );
    const doc = await vscode.workspace.openTextDocument(jsxUri);
    await vscode.window.showTextDocument(doc);

    // Position cursor on "card-header" in className="card-header"
    const text = doc.getText();
    const classNameIdx = text.indexOf('card-header');
    assert.ok(classNameIdx >= 0, 'Expected to find "card-header" in JSX fixture');
    const pos = doc.positionAt(classNameIdx);

    const locations = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      jsxUri,
      pos,
    );

    assert.ok(locations && locations.length > 0, 'Expected at least one definition for "card-header"');

    const loc = locations[0];
    assert.ok(
      loc.uri.fsPath.endsWith(path.join('styles', 'sample.scss')),
      `Expected definition in sample.scss, got ${loc.uri.fsPath}`,
    );
  }

  // --- endsWith match: "title" in JSX → ".card .title" in SCSS ---
  {
    const jsxUri = vscode.Uri.file(
      path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'components', 'Sample.jsx'),
    );
    const doc = await vscode.workspace.openTextDocument(jsxUri);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    const titleIdx = text.indexOf('"title"');
    assert.ok(titleIdx >= 0, 'Expected to find "title" in JSX fixture');
    // Position inside the word "title" (skip the quote)
    const pos = doc.positionAt(titleIdx + 1);

    const locations = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      jsxUri,
      pos,
    );

    assert.ok(locations && locations.length > 0, 'Expected at least one definition for "title" (endsWith)');

    const loc = locations[0];
    assert.ok(
      loc.uri.fsPath.endsWith(path.join('styles', 'sample.scss')),
      `Expected definition in sample.scss, got ${loc.uri.fsPath}`,
    );
  }

  // --- No match: "nonexistent" should return no definitions ---
  {
    const jsxUri = vscode.Uri.file(
      path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'components', 'Sample.jsx'),
    );
    const doc = await vscode.workspace.openTextDocument(jsxUri);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    const idx = text.indexOf('nonexistent');
    assert.ok(idx >= 0, 'Expected to find "nonexistent" in JSX fixture');
    const pos = doc.positionAt(idx);

    const locations = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      jsxUri,
      pos,
    );

    assert.ok(
      !locations || locations.length === 0,
      'Expected no definitions for "nonexistent"',
    );
  }

  // --- HTML: "card-header" in HTML → .card-header in SCSS ---
  {
    const htmlUri = vscode.Uri.file(
      path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'pages', 'index.html'),
    );
    const doc = await vscode.workspace.openTextDocument(htmlUri);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    const idx = text.indexOf('card-header');
    assert.ok(idx >= 0, 'Expected to find "card-header" in HTML fixture');
    const pos = doc.positionAt(idx);

    const locations = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      htmlUri,
      pos,
    );

    assert.ok(locations && locations.length > 0, 'Expected at least one definition for "card-header" from HTML');

    const loc = locations[0];
    assert.ok(
      loc.uri.fsPath.endsWith(path.join('styles', 'sample.scss')),
      `Expected definition in sample.scss, got ${loc.uri.fsPath}`,
    );
  }
}

module.exports = { run };
