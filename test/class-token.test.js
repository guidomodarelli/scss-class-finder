const test = require('node:test');
const assert = require('node:assert/strict');

const { findClassTokenAtOffset } = require('../out/classToken.js');

test('findClassTokenAtOffset: resolves full hyphenated class from any token character', () => {
  const text = '<div className="card-header">Hello</div>';
  const start = text.indexOf('card-header');

  const positionsToCheck = [
    start,
    start + 4,
    start + 5,
    start + 'card-header'.length - 1,
  ];

  for (const offset of positionsToCheck) {
    assert.deepEqual(findClassTokenAtOffset(text, offset), {
      value: 'card-header',
      start,
      end: start + 'card-header'.length,
    });
  }
});

test('findClassTokenAtOffset: keeps full token when cursor is at the end of the class', () => {
  const text = '<div class="nav-item"></div>';
  const start = text.indexOf('nav-item');
  const end = start + 'nav-item'.length;

  assert.deepEqual(findClassTokenAtOffset(text, end), {
    value: 'nav-item',
    start,
    end,
  });
});

test('findClassTokenAtOffset: supports underscores and double hyphens', () => {
  const text = 'const className = "card_header--active";';
  const start = text.indexOf('card_header--active');

  assert.deepEqual(findClassTokenAtOffset(text, start + 12), {
    value: 'card_header--active',
    start,
    end: start + 'card_header--active'.length,
  });
});

test('findClassTokenAtOffset: returns null outside a class token', () => {
  const text = '<div class="card-header"></div>';
  const quoteOffset = text.indexOf('"');

  assert.equal(findClassTokenAtOffset(text, quoteOffset), null);
});
