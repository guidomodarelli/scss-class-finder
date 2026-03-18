const test = require('node:test');
const assert = require('node:assert/strict');

const { splitSelectors, resolveSelectors } = require('../out/selectorResolver.js');

test('splitSelectors keeps commas inside pseudo-class arguments', () => {
  const input = '.a, .b:not(.x,.y), .c:has(.p, .q), .d';
  const parts = splitSelectors(input);

  assert.deepEqual(parts, [
    '.a',
    '.b:not(.x,.y)',
    '.c:has(.p, .q)',
    '.d',
  ]);
});

test('resolveSelectors handles ampersand concatenation and descendants', () => {
  const scss = `
.bodyCard {
  &-header { color: red; }
  &.active { color: blue; }
  .title { color: green; }
}
`;

  const selectors = resolveSelectors(scss).map((s) => s.resolved);

  assert.ok(selectors.includes('.bodyCard'));
  assert.ok(selectors.includes('.bodyCard-header'));
  assert.ok(selectors.includes('.bodyCard.active'));
  assert.ok(selectors.includes('.bodyCard .title'));
});

test('resolveSelectors expands comma selector lists with nested ampersand', () => {
  const scss = `
.a, .b {
  &-x { color: red; }
}
`;

  const selectors = resolveSelectors(scss).map((s) => s.resolved);

  assert.ok(selectors.includes('.a'));
  assert.ok(selectors.includes('.b'));
  assert.ok(selectors.includes('.a-x'));
  assert.ok(selectors.includes('.b-x'));
});

test('resolveSelectors ignores comments and keeps parent across at-rules', () => {
  const scss = `
// .fake { }
.container {
  /* .ghost { } */
  @media (min-width: 10px) {
    &-fluid { color: red; }
  }
}
`;

  const selectors = resolveSelectors(scss).map((s) => s.resolved);

  assert.ok(selectors.includes('.container'));
  assert.ok(selectors.includes('.container-fluid'));
  assert.equal(selectors.some((s) => s.includes('.fake')), false);
  assert.equal(selectors.some((s) => s.includes('.ghost')), false);
});

test('resolveSelectors does not treat interpolation braces as rule blocks', () => {
  const scss = `
$className: 'chip';
.#{ $className } {
  &-label { color: red; }
}
`;

  const selectors = resolveSelectors(scss).map((s) => s.resolved);

  assert.ok(selectors.includes('.#{ $className }'));
  assert.ok(selectors.includes('.#{ $className }-label'));
});
