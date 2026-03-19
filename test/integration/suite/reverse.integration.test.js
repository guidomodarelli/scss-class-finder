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

  // --- Resolve aliased @import path to the target style file ---
  {
    const scssUri = vscode.Uri.file(
      path.join(workspaceRoot, 'styles', 'sample.scss'),
    );
    const doc = await vscode.workspace.openTextDocument(scssUri);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    const importPathIdx = text.indexOf('Settings/styles');
    assert.ok(importPathIdx >= 0, 'Expected to find @import path in SCSS fixture');
    const pos = doc.positionAt(importPathIdx + 'Settings/'.length + 1); // position on "styles"

    const locations = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      scssUri,
      pos,
    );

    assert.ok(
      locations && locations.length === 1,
      `Expected one definition result from aliased @import path, got: ${(locations ?? []).map((loc) => loc.uri.fsPath).join(', ')}`,
    );
    assert.ok(
      locations[0].uri.fsPath.endsWith(path.join('app', 'components', 'Settings', 'styles.scss')),
      `Expected aliased @import to resolve to Settings/styles.scss, got: ${locations[0].uri.fsPath}`,
    );
    assert.ok(
      locations[0].originSelectionRange,
      'Expected aliased @import definition to expose originSelectionRange for Ctrl+Click highlighting',
    );
    assert.equal(
      doc.getText(locations[0].originSelectionRange),
      '~@root/app/components/Settings/styles',
      'Expected Ctrl+Click highlight to cover the full @import string content',
    );
  }

  // --- Resolve aliased @use path and fall back to .sass ---
  {
    const scssUri = vscode.Uri.file(
      path.join(workspaceRoot, 'styles', 'sample.scss'),
    );
    const doc = await vscode.workspace.openTextDocument(scssUri);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    const usePathIdx = text.indexOf('Typography/styles');
    assert.ok(usePathIdx >= 0, 'Expected to find @use path in SCSS fixture');
    const pos = doc.positionAt(usePathIdx + 'Typography/'.length + 1);

    const locations = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      scssUri,
      pos,
    );

    assert.ok(
      locations && locations.length === 1,
      `Expected one definition result from aliased @use path, got: ${(locations ?? []).map((loc) => loc.uri.fsPath).join(', ')}`,
    );
    assert.ok(
      locations[0].uri.fsPath.endsWith(path.join('app', 'components', 'Typography', 'styles.sass')),
      `Expected aliased @use to resolve to Typography/styles.sass, got: ${locations[0].uri.fsPath}`,
    );
  }

  // --- Resolve aliased @forward path and fall back to .css ---
  {
    const scssUri = vscode.Uri.file(
      path.join(workspaceRoot, 'styles', 'sample.scss'),
    );
    const doc = await vscode.workspace.openTextDocument(scssUri);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    const forwardPathIdx = text.indexOf('Theme/styles');
    assert.ok(forwardPathIdx >= 0, 'Expected to find @forward path in SCSS fixture');
    const pos = doc.positionAt(forwardPathIdx + 'Theme/'.length + 1);

    const locations = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      scssUri,
      pos,
    );

    assert.ok(
      locations && locations.length === 1,
      `Expected one definition result from aliased @forward path, got: ${(locations ?? []).map((loc) => loc.uri.fsPath).join(', ')}`,
    );
    assert.ok(
      locations[0].uri.fsPath.endsWith(path.join('app', 'components', 'Theme', 'styles.css')),
      `Expected aliased @forward to resolve to Theme/styles.css, got: ${locations[0].uri.fsPath}`,
    );
  }

  // --- Resolve aliased @import path to a Sass partial with underscore basename ---
  {
    const scssUri = vscode.Uri.file(
      path.join(workspaceRoot, 'styles', 'sample.scss'),
    );
    const doc = await vscode.workspace.openTextDocument(scssUri);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    const partialImportPathIdx = text.indexOf('app/styles/common');
    assert.ok(partialImportPathIdx >= 0, 'Expected to find partial @import path in SCSS fixture');
    const pos = doc.positionAt(partialImportPathIdx + 'app/styles/'.length + 1);

    const locations = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      scssUri,
      pos,
    );

    assert.ok(
      locations && locations.length === 1,
      `Expected one definition result from aliased partial @import path, got: ${(locations ?? []).map((loc) => loc.uri.fsPath).join(', ')}`,
    );
    assert.ok(
      locations[0].uri.fsPath.endsWith(path.join('app', 'styles', '_common.scss')),
      `Expected aliased @import to resolve to app/styles/_common.scss, got: ${locations[0].uri.fsPath}`,
    );
  }

  // --- Unknown aliases should not fall back to reverse usage search ---
  {
    const scssUri = vscode.Uri.file(
      path.join(workspaceRoot, 'styles', 'sample.scss'),
    );
    const doc = await vscode.workspace.openTextDocument(scssUri);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    const unknownPathIdx = text.indexOf('Missing/styles');
    assert.ok(unknownPathIdx >= 0, 'Expected to find unknown alias path in SCSS fixture');
    const pos = doc.positionAt(unknownPathIdx + 'Missing/'.length + 1);

    const locations = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      scssUri,
      pos,
    );

    assert.ok(
      !locations || locations.length === 0,
      `Expected no definition results for unknown aliased import path, got: ${(locations ?? []).map((loc) => loc.uri.fsPath).join(', ')}`,
    );
  }

  // --- Sass variables should not be treated as class reverse navigation targets ---
  {
    const scssUri = vscode.Uri.file(
      path.join(workspaceRoot, 'styles', 'sample.scss'),
    );
    const doc = await vscode.workspace.openTextDocument(scssUri);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    const variableIdx = text.indexOf('$gray-300');
    assert.ok(variableIdx >= 0, 'Expected to find "$gray-300" in SCSS fixture');
    const pos = doc.positionAt(variableIdx + 2);

    const locations = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      scssUri,
      pos,
    );

    const hasCodeTarget = (locations ?? []).some((loc) => {
      const filePath = loc.uri.fsPath;
      return filePath.endsWith('.jsx') || filePath.endsWith('.tsx') || filePath.endsWith('.html');
    });

    assert.equal(
      hasCodeTarget,
      false,
      'Expected Sass variable navigation to avoid reverse class usages in JSX/HTML',
    );
  }

  // --- CSS custom properties should resolve to their declarations, not to class usages ---
  {
    const scssUri = vscode.Uri.file(
      path.join(workspaceRoot, 'styles', 'sample.scss'),
    );
    const doc = await vscode.workspace.openTextDocument(scssUri);
    await vscode.window.showTextDocument(doc);

    const usageToDefinitionExpectations = [
      '--brand-spacing-16',
      '--brand-spacing-24',
      '--brand-spacing-32',
    ];

    for (const customPropertyName of usageToDefinitionExpectations) {
      const usageIndex = doc.getText().lastIndexOf(customPropertyName);
      assert.ok(usageIndex >= 0, `Expected to find "${customPropertyName}" in SCSS fixture`);
      const pos = doc.positionAt(usageIndex + 4);

      const locations = await vscode.commands.executeCommand(
        'vscode.executeDefinitionProvider',
        scssUri,
        pos,
      );

      assert.ok(
        locations && locations.length > 0,
        `Expected definition results for CSS custom property "${customPropertyName}"`,
      );

      const hasCodeTarget = locations.some((loc) => {
        const filePath = loc.uri.fsPath;
        return filePath.endsWith('.jsx') || filePath.endsWith('.tsx') || filePath.endsWith('.html');
      });
      assert.equal(
        hasCodeTarget,
        false,
        `Expected "${customPropertyName}" to avoid reverse class usages in JSX/HTML`,
      );

      const hasStyleDefinitionTarget = locations.some((loc) =>
        loc.uri.fsPath.endsWith(path.join('styles', 'sample.scss')),
      );
      assert.equal(
        hasStyleDefinitionTarget,
        true,
        `Expected "${customPropertyName}" to resolve inside sample.scss`,
      );

      assert.ok(
        locations[0].originSelectionRange,
        `Expected "${customPropertyName}" definition to expose originSelectionRange`,
      );
      assert.equal(
        doc.getText(locations[0].originSelectionRange),
        customPropertyName,
        `Expected Ctrl+Click highlight to cover the full custom property "${customPropertyName}"`,
      );
    }
  }

  // --- CSS function tokens should keep the default editor behavior (no reverse class navigation) ---
  {
    const scssUri = vscode.Uri.file(
      path.join(workspaceRoot, 'styles', 'sample.scss'),
    );
    const doc = await vscode.workspace.openTextDocument(scssUri);
    await vscode.window.showTextDocument(doc);

    const functionNames = ['hsl', 'var', 'string'];

    for (const functionName of functionNames) {
      const functionIndex = doc.getText().indexOf(`${functionName}(`);
      assert.ok(functionIndex >= 0, `Expected to find "${functionName}(" in SCSS fixture`);
      const pos = doc.positionAt(functionIndex + 1);

      const locations = await vscode.commands.executeCommand(
        'vscode.executeDefinitionProvider',
        scssUri,
        pos,
      );

      assert.ok(
        !locations || locations.length === 0,
        `Expected no reverse definition results for CSS function "${functionName}()", got: ${(locations ?? []).map((loc) => loc.uri.fsPath).join(', ')}`,
      );
    }
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
