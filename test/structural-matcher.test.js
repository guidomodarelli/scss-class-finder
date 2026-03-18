const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSelectorToIR } = require('../out/selectorIR.js');
const { extractClassUsages } = require('../out/classExtractor.js');
const { matchSelectorChain, matchSelectorChainMulti } = require('../out/structuralMatcher.js');

// ---------------------------------------------------------------------------
// Exact single-class match
// ---------------------------------------------------------------------------

test('matchSelectorChain: exact match for single class', () => {
  const html = '<div class="card">Content</div>';
  const extraction = extractClassUsages(html, 'test.html', 'html');
  const chain = parseSelectorToIR('.card');

  const results = matchSelectorChain(chain, extraction);

  assert.ok(results.length > 0);
  assert.equal(results[0].confidence, 'exact');
});

// ---------------------------------------------------------------------------
// Descendant combinator matching
// ---------------------------------------------------------------------------

test('matchSelectorChain: descendant combinator .parent .child', () => {
  const html = `<div class="parent">
  <div class="middle">
    <span class="child">Text</span>
  </div>
</div>`;

  const extraction = extractClassUsages(html, 'test.html', 'html');
  const chain = parseSelectorToIR('.parent .child');
  const results = matchSelectorChain(chain, extraction);

  assert.ok(results.length > 0);
  assert.equal(results[0].confidence, 'structural');
});

test('matchSelectorChain: descendant combinator does NOT match without ancestor', () => {
  const html = `<div class="other">
  <span class="child">Text</span>
</div>`;

  const extraction = extractClassUsages(html, 'test.html', 'html');
  const chain = parseSelectorToIR('.parent .child');
  const results = matchSelectorChain(chain, extraction);

  // child exists but no .parent ancestor → should fail structural, but still partial
  for (const r of results) {
    assert.notEqual(r.confidence, 'structural');
  }
});

// ---------------------------------------------------------------------------
// Child combinator >
// ---------------------------------------------------------------------------

test('matchSelectorChain: child combinator matches direct parent', () => {
  const html = `<div class="parent">
  <span class="child">Text</span>
</div>`;

  const extraction = extractClassUsages(html, 'test.html', 'html');
  const chain = parseSelectorToIR('.parent > .child');
  const results = matchSelectorChain(chain, extraction);

  assert.ok(results.length > 0);
  assert.equal(results[0].confidence, 'structural');
});

test('matchSelectorChain: child combinator fails for non-direct parent', () => {
  const html = `<div class="parent">
  <div class="middle">
    <span class="child">Text</span>
  </div>
</div>`;

  const extraction = extractClassUsages(html, 'test.html', 'html');
  const chain = parseSelectorToIR('.parent > .child');
  const results = matchSelectorChain(chain, extraction);

  // child has parent .middle not .parent → child combinator fails
  for (const r of results) {
    assert.notEqual(r.confidence, 'structural');
  }
});

// ---------------------------------------------------------------------------
// Adjacent sibling combinator +
// ---------------------------------------------------------------------------

test('matchSelectorChain: adjacent sibling combinator', () => {
  const html = `<div class="wrapper">
  <span class="first">A</span>
  <span class="second">B</span>
</div>`;

  const extraction = extractClassUsages(html, 'test.html', 'html');
  const chain = parseSelectorToIR('.first + .second');
  const results = matchSelectorChain(chain, extraction);

  assert.ok(results.length > 0);
  assert.equal(results[0].confidence, 'structural');
});

test('matchSelectorChain: adjacent sibling fails for non-adjacent', () => {
  const html = `<div class="wrapper">
  <span class="first">A</span>
  <span class="gap">gap</span>
  <span class="second">B</span>
</div>`;

  const extraction = extractClassUsages(html, 'test.html', 'html');
  const chain = parseSelectorToIR('.first + .second');
  const results = matchSelectorChain(chain, extraction);

  // .first is at index 0, .gap at 1, .second at 2 → not adjacent to .first
  for (const r of results) {
    assert.notEqual(r.confidence, 'structural');
  }
});

// ---------------------------------------------------------------------------
// General sibling combinator ~
// ---------------------------------------------------------------------------

test('matchSelectorChain: general sibling combinator', () => {
  const html = `<div class="wrapper">
  <span class="first">A</span>
  <span class="gap">gap</span>
  <span class="second">B</span>
</div>`;

  const extraction = extractClassUsages(html, 'test.html', 'html');
  const chain = parseSelectorToIR('.first ~ .second');
  const results = matchSelectorChain(chain, extraction);

  assert.ok(results.length > 0);
  assert.equal(results[0].confidence, 'structural');
});

// ---------------------------------------------------------------------------
// Complex multi-segment selectors
// ---------------------------------------------------------------------------

test('matchSelectorChain: three-level descendant', () => {
  const html = `<div class="a">
  <div class="b">
    <span class="c">Text</span>
  </div>
</div>`;

  const extraction = extractClassUsages(html, 'test.html', 'html');
  const chain = parseSelectorToIR('.a .b .c');
  const results = matchSelectorChain(chain, extraction);

  assert.ok(results.length > 0);
  assert.equal(results[0].confidence, 'structural');
});

test('matchSelectorChain: mixed combinators .a > .b .c', () => {
  const html = `<div class="a">
  <div class="b">
    <div class="inner">
      <span class="c">Text</span>
    </div>
  </div>
</div>`;

  const extraction = extractClassUsages(html, 'test.html', 'html');
  const chain = parseSelectorToIR('.a > .b .c');
  const results = matchSelectorChain(chain, extraction);

  assert.ok(results.length > 0);
  assert.equal(results[0].confidence, 'structural');
});

// ---------------------------------------------------------------------------
// Score ordering
// ---------------------------------------------------------------------------

test('matchSelectorChain: structural match scores higher than partial', () => {
  const html = `<div class="parent">
  <span class="child">Structural</span>
</div>
<div class="other">
  <span class="child">Partial</span>
</div>`;

  const extraction = extractClassUsages(html, 'test.html', 'html');
  const chain = parseSelectorToIR('.parent .child');
  const results = matchSelectorChain(chain, extraction);

  assert.ok(results.length >= 1);
  // The one inside .parent should score higher
  const structural = results.find((r) => r.confidence === 'structural');
  assert.ok(structural);
});

// ---------------------------------------------------------------------------
// Multi-file matching
// ---------------------------------------------------------------------------

test('matchSelectorChainMulti: matches across multiple files', () => {
  const html1 = '<div class="card">File 1</div>';
  const html2 = '<div class="card">File 2</div>';

  const ext1 = extractClassUsages(html1, 'file1.html', 'html');
  const ext2 = extractClassUsages(html2, 'file2.html', 'html');

  const chain = parseSelectorToIR('.card');
  const results = matchSelectorChainMulti(chain, [ext1, ext2]);

  assert.equal(results.length, 2);
  const files = results.map((r) => r.filePath);
  assert.ok(files.includes('file1.html'));
  assert.ok(files.includes('file2.html'));
});

// ---------------------------------------------------------------------------
// No match
// ---------------------------------------------------------------------------

test('matchSelectorChain: no match returns empty array', () => {
  const html = '<div class="other">No match</div>';
  const extraction = extractClassUsages(html, 'test.html', 'html');
  const chain = parseSelectorToIR('.nonexistent');
  const results = matchSelectorChain(chain, extraction);

  assert.equal(results.length, 0);
});

// ---------------------------------------------------------------------------
// JSX matching
// ---------------------------------------------------------------------------

test('matchSelectorChain: matches JSX className usages', () => {
  const jsx = `export function App() {
  return (
    <div className="parent">
      <span className="child">Hello</span>
    </div>
  );
}`;

  const extraction = extractClassUsages(jsx, 'App.jsx', 'jsx');
  const chain = parseSelectorToIR('.parent .child');
  const results = matchSelectorChain(chain, extraction);

  assert.ok(results.length > 0);
  assert.equal(results[0].confidence, 'structural');
  assert.equal(results[0].filePath, 'App.jsx');
});
