const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.all.find(
    (ext) => ext.packageJSON && ext.packageJSON.name === 'scss-class-finder',
  );
  assert.ok(extension, 'Expected extension scss-class-finder to be loaded');

  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  assert.ok(
    commands.includes('scssClassFinder.findClass'),
    'Expected scssClassFinder.findClass to be registered',
  );

  await vscode.commands.executeCommand('scssClassFinder.findClass', {
    query: 'card-header',
    autoPickFirst: true,
    previewOnResultFocus: false,
    suppressNoResultsMessage: true,
  });

  const activeEditor = vscode.window.activeTextEditor;
  assert.ok(activeEditor, 'Expected an active editor after command execution');

  const fileName = activeEditor.document.fileName;
  assert.ok(
    fileName.endsWith(path.join('styles', 'sample.scss')),
    `Expected sample.scss to be opened, got ${fileName}`,
  );

  const openedText = activeEditor.document.getText();
  assert.ok(
    openedText.includes('.card') && openedText.includes('&-header'),
    'Expected the fixture SCSS file to be opened',
  );
}

module.exports = { run };
