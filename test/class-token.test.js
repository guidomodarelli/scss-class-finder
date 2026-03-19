const test = require('node:test');
const assert = require('node:assert/strict');

const { findClassTokenAtOffset, findSassVariableAtOffset } = require('../out/classToken.js');

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

test('findSassVariableAtOffset: resolves full Sass variable name', () => {
  const text = '$gray-300: #d1d5db;';
  const start = text.indexOf('gray-300');

  assert.deepEqual(findSassVariableAtOffset(text, start + 4), {
    value: '$gray-300',
    start: start - 1,
    end: start - 1 + '$gray-300'.length,
  });
});

test('findSassVariableAtOffset: returns null for plain class-like tokens', () => {
  const text = '.gray-300 { color: red; }';
  const start = text.indexOf('gray-300');

  assert.equal(findSassVariableAtOffset(text, start + 2), null);
});
