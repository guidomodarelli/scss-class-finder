const test = require('node:test');
const assert = require('node:assert/strict');

const { extractClassUsages } = require('../out/classExtractor.js');

// ---------------------------------------------------------------------------
// HTML extraction
// ---------------------------------------------------------------------------

test('extractClassUsages: HTML basic class extraction', () => {
  const html = `<div class="card">
  <span class="title">Hello</span>
</div>`;

  const result = extractClassUsages(html, 'test.html', 'html');
  const classNames = result.nodes.map((n) => n.classes).flat();

  assert.ok(classNames.includes('card'));
  assert.ok(classNames.includes('title'));
});

test('extractClassUsages: HTML multiple classes on one element', () => {
  const html = '<div class="card active highlighted">Content</div>';
  const result = extractClassUsages(html, 'test.html', 'html');

  assert.equal(result.nodes.length, 1);
  assert.deepEqual(result.nodes[0].classes, ['card', 'active', 'highlighted']);
});

test('extractClassUsages: HTML parent-child relationship', () => {
  const html = `<div class="parent">
  <div class="child">
    <span class="grandchild">Text</span>
  </div>
</div>`;

  const result = extractClassUsages(html, 'test.html', 'html');

  const grandchild = result.nodes.find((n) => n.classes.includes('grandchild'));
  assert.ok(grandchild);
  assert.ok(grandchild.parent);
  assert.ok(grandchild.parent.classes.includes('child'));
  assert.ok(grandchild.parent.parent);
  assert.ok(grandchild.parent.parent.classes.includes('parent'));
});

test('extractClassUsages: HTML sibling indices', () => {
  const html = `<div class="parent">
  <span class="first">A</span>
  <span class="second">B</span>
  <span class="third">C</span>
</div>`;

  const result = extractClassUsages(html, 'test.html', 'html');

  const first = result.nodes.find((n) => n.classes.includes('first'));
  const second = result.nodes.find((n) => n.classes.includes('second'));
  const third = result.nodes.find((n) => n.classes.includes('third'));

  assert.equal(first.siblingIndex, 0);
  assert.equal(second.siblingIndex, 1);
  assert.equal(third.siblingIndex, 2);
});

test('extractClassUsages: HTML self-closing tags', () => {
  const html = `<div class="wrapper">
  <img class="icon" />
  <span class="label">Text</span>
</div>`;

  const result = extractClassUsages(html, 'test.html', 'html');

  const label = result.nodes.find((n) => n.classes.includes('label'));
  assert.ok(label);
  // label should be sibling of img, not child of img
  assert.equal(label.siblingIndex, 1);
  assert.ok(label.parent.classes.includes('wrapper'));
});

test('extractClassUsages: HTML void elements (no closing tag)', () => {
  const html = `<div class="form">
  <input class="input-field">
  <span class="help">Help text</span>
</div>`;

  const result = extractClassUsages(html, 'test.html', 'html');

  const help = result.nodes.find((n) => n.classes.includes('help'));
  assert.ok(help);
  assert.ok(help.parent.classes.includes('form'));
});

// ---------------------------------------------------------------------------
// JSX extraction
// ---------------------------------------------------------------------------

test('extractClassUsages: JSX className string literal', () => {
  const jsx = `export function App() {
  return <div className="card-header">Hello</div>;
}`;

  const result = extractClassUsages(jsx, 'App.jsx', 'jsx');
  const classNames = result.nodes.map((n) => n.classes).flat();

  assert.ok(classNames.includes('card-header'));
});

test('extractClassUsages: JSX className with curly braces', () => {
  const jsx = `export function App() {
  return <div className={'card'}>Hello</div>;
}`;

  const result = extractClassUsages(jsx, 'App.jsx', 'jsx');
  const classNames = result.nodes.map((n) => n.classes).flat();

  assert.ok(classNames.includes('card'));
});

test('extractClassUsages: JSX className with template literal', () => {
  const jsx = 'export function App() {\n  return <div className={`card active`}>Hello</div>;\n}';

  const result = extractClassUsages(jsx, 'App.jsx', 'jsx');
  const classNames = result.nodes.map((n) => n.classes).flat();

  assert.ok(classNames.includes('card'));
  assert.ok(classNames.includes('active'));
});

test('extractClassUsages: JSX parent-child structure', () => {
  const jsx = `export function App() {
  return (
    <div className="parent">
      <span className="child">Text</span>
    </div>
  );
}`;

  const result = extractClassUsages(jsx, 'App.jsx', 'jsx');

  const child = result.nodes.find((n) => n.classes.includes('child'));
  assert.ok(child);
  assert.ok(child.parent);
  assert.ok(child.parent.classes.includes('parent'));
});

test('extractClassUsages: JSX self-closing component', () => {
  const jsx = `export function App() {
  return (
    <div className="wrapper">
      <Icon className="icon" />
      <span className="label">Text</span>
    </div>
  );
}`;

  const result = extractClassUsages(jsx, 'App.jsx', 'jsx');

  const label = result.nodes.find((n) => n.classes.includes('label'));
  assert.ok(label);
  assert.equal(label.siblingIndex, 1);
});

test('extractClassUsages: JSX clsx helper', () => {
  const jsx = `export function App({ active }) {
  return <div className={clsx('card', 'main', active && 'active')}>Hello</div>;
}`;

  const result = extractClassUsages(jsx, 'App.jsx', 'jsx');
  const classNames = result.nodes.map((n) => n.classes).flat();

  assert.ok(classNames.includes('card'));
  assert.ok(classNames.includes('main'));
});

test('extractClassUsages: JSX classnames helper', () => {
  const jsx = `export function App() {
  return <div className={classnames('btn', 'primary')}>Click</div>;
}`;

  const result = extractClassUsages(jsx, 'App.jsx', 'jsx');
  const classNames = result.nodes.map((n) => n.classes).flat();

  assert.ok(classNames.includes('btn'));
  assert.ok(classNames.includes('primary'));
});

// ---------------------------------------------------------------------------
// TSX extraction (same logic, different lang hint)
// ---------------------------------------------------------------------------

test('extractClassUsages: TSX extraction works like JSX', () => {
  const tsx = `export function App(): JSX.Element {
  return <div className="card">Hello</div>;
}`;

  const result = extractClassUsages(tsx, 'App.tsx', 'tsx');
  const classNames = result.nodes.map((n) => n.classes).flat();

  assert.ok(classNames.includes('card'));
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('extractClassUsages: no classes found returns empty nodes', () => {
  const html = '<div><span>No classes here</span></div>';
  const result = extractClassUsages(html, 'test.html', 'html');

  assert.equal(result.nodes.length, 0);
});

test('extractClassUsages: single-quoted class attribute', () => {
  const html = "<div class='card'>Content</div>";
  const result = extractClassUsages(html, 'test.html', 'html');

  assert.ok(result.nodes.some((n) => n.classes.includes('card')));
});

test('extractClassUsages: line numbers are correct', () => {
  const html = `<html>
<body>
<div class="target">Hello</div>
</body>
</html>`;

  const result = extractClassUsages(html, 'test.html', 'html');
  const target = result.nodes.find((n) => n.classes.includes('target'));

  assert.ok(target);
  assert.equal(target.line, 2); // 0-based, so line 3 in editor
});
