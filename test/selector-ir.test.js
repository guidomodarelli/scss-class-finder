const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSelectorToIR, getTargetClasses, getAllClasses } = require('../out/selectorIR.js');

// ---------------------------------------------------------------------------
// parseSelectorToIR — basic selectors
// ---------------------------------------------------------------------------

test('parseSelectorToIR: single class', () => {
  const chain = parseSelectorToIR('.card');
  assert.equal(chain.segments.length, 1);
  assert.deepEqual(chain.segments[0].classes, ['card']);
  assert.equal(chain.segments[0].combinator, 'root');
});

test('parseSelectorToIR: multiple classes on one element', () => {
  const chain = parseSelectorToIR('.card.active');
  assert.equal(chain.segments.length, 1);
  assert.deepEqual(chain.segments[0].classes, ['card', 'active']);
});

test('parseSelectorToIR: tag + class + id', () => {
  const chain = parseSelectorToIR('div.card#main');
  assert.equal(chain.segments.length, 1);
  assert.equal(chain.segments[0].tag, 'div');
  assert.deepEqual(chain.segments[0].classes, ['card']);
  assert.deepEqual(chain.segments[0].ids, ['main']);
});

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

test('parseSelectorToIR: descendant combinator', () => {
  const chain = parseSelectorToIR('.parent .child');
  assert.equal(chain.segments.length, 2);
  assert.deepEqual(chain.segments[0].classes, ['parent']);
  assert.equal(chain.segments[0].combinator, 'root');
  assert.deepEqual(chain.segments[1].classes, ['child']);
  assert.equal(chain.segments[1].combinator, 'descendant');
});

test('parseSelectorToIR: child combinator >', () => {
  const chain = parseSelectorToIR('.parent > .child');
  assert.equal(chain.segments.length, 2);
  assert.deepEqual(chain.segments[0].classes, ['parent']);
  assert.deepEqual(chain.segments[1].classes, ['child']);
  assert.equal(chain.segments[1].combinator, 'child');
});

test('parseSelectorToIR: adjacent sibling combinator +', () => {
  const chain = parseSelectorToIR('.a + .b');
  assert.equal(chain.segments.length, 2);
  assert.equal(chain.segments[1].combinator, 'adjacent');
});

test('parseSelectorToIR: general sibling combinator ~', () => {
  const chain = parseSelectorToIR('.a ~ .b');
  assert.equal(chain.segments.length, 2);
  assert.equal(chain.segments[1].combinator, 'sibling');
});

test('parseSelectorToIR: mixed combinators', () => {
  const chain = parseSelectorToIR('.a > .b .c + .d ~ .e');
  assert.equal(chain.segments.length, 5);
  assert.equal(chain.segments[0].combinator, 'root');
  assert.equal(chain.segments[1].combinator, 'child');
  assert.equal(chain.segments[2].combinator, 'descendant');
  assert.equal(chain.segments[3].combinator, 'adjacent');
  assert.equal(chain.segments[4].combinator, 'sibling');
});

// ---------------------------------------------------------------------------
// Pseudo-classes and pseudo-elements
// ---------------------------------------------------------------------------

test('parseSelectorToIR: pseudo-class :hover', () => {
  const chain = parseSelectorToIR('.btn:hover');
  assert.equal(chain.segments.length, 1);
  assert.deepEqual(chain.segments[0].classes, ['btn']);
  assert.deepEqual(chain.segments[0].pseudos, [':hover']);
});

test('parseSelectorToIR: pseudo-element ::before', () => {
  const chain = parseSelectorToIR('.btn::before');
  assert.equal(chain.segments.length, 1);
  assert.deepEqual(chain.segments[0].pseudos, ['::before']);
});

test('parseSelectorToIR: functional pseudo :has()', () => {
  const chain = parseSelectorToIR('.list:has(.item)');
  assert.equal(chain.segments.length, 1);
  assert.deepEqual(chain.segments[0].classes, ['list']);
  assert.deepEqual(chain.segments[0].pseudos, [':has(.item)']);
});

test('parseSelectorToIR: chained pseudos', () => {
  const chain = parseSelectorToIR('.input:focus:not(:disabled)');
  assert.equal(chain.segments.length, 1);
  assert.deepEqual(chain.segments[0].classes, ['input']);
  assert.equal(chain.segments[0].pseudos.length, 2);
  assert.equal(chain.segments[0].pseudos[0], ':focus');
  assert.equal(chain.segments[0].pseudos[1], ':not(:disabled)');
});

// ---------------------------------------------------------------------------
// Attribute selectors
// ---------------------------------------------------------------------------

test('parseSelectorToIR: attribute selector', () => {
  const chain = parseSelectorToIR('input[type="text"]');
  assert.equal(chain.segments.length, 1);
  assert.equal(chain.segments[0].tag, 'input');
  assert.deepEqual(chain.segments[0].attributes, ['[type="text"]']);
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

test('getTargetClasses returns classes of rightmost segment', () => {
  const chain = parseSelectorToIR('.parent > .child.active');
  assert.deepEqual(getTargetClasses(chain), ['child', 'active']);
});

test('getAllClasses returns all classes across segments', () => {
  const chain = parseSelectorToIR('.a .b > .c');
  const all = getAllClasses(chain);
  assert.deepEqual(all, ['a', 'b', 'c']);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('parseSelectorToIR: universal selector', () => {
  const chain = parseSelectorToIR('* .child');
  assert.equal(chain.segments.length, 2);
  assert.equal(chain.segments[0].tag, '*');
  assert.deepEqual(chain.segments[1].classes, ['child']);
});

test('parseSelectorToIR: complex multi-segment selector', () => {
  const chain = parseSelectorToIR('.wrapper > div.card .title + .subtitle');
  assert.equal(chain.segments.length, 4);
  assert.deepEqual(chain.segments[0].classes, ['wrapper']);
  assert.equal(chain.segments[1].tag, 'div');
  assert.deepEqual(chain.segments[1].classes, ['card']);
  assert.equal(chain.segments[1].combinator, 'child');
  assert.deepEqual(chain.segments[2].classes, ['title']);
  assert.equal(chain.segments[2].combinator, 'descendant');
  assert.deepEqual(chain.segments[3].classes, ['subtitle']);
  assert.equal(chain.segments[3].combinator, 'adjacent');
});
