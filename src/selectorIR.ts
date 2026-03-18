// ---------------------------------------------------------------------------
// Selector Intermediate Representation (IR)
// ---------------------------------------------------------------------------
// Transforms a resolved CSS selector string into a structured list of
// segments connected by combinators, enabling structural matching against
// a markup node tree.
// ---------------------------------------------------------------------------

export type Combinator = 'root' | 'descendant' | 'child' | 'adjacent' | 'sibling';

export interface SelectorSegment {
  /** Element/tag selector, e.g. "div", "span". Empty string if none. */
  tag: string;
  /** Class selectors without the leading dot, e.g. ["card", "active"]. */
  classes: string[];
  /** ID selectors without the leading #, e.g. ["main"]. */
  ids: string[];
  /** Attribute selectors as raw strings, e.g. ['[data-x="1"]']. */
  attributes: string[];
  /** Pseudo-classes/elements as raw strings, e.g. [":hover", "::before"]. */
  pseudos: string[];
  /** Relationship to the previous segment in the chain. */
  combinator: Combinator;
}

export interface SelectorChain {
  /** Ordered list of segments from leftmost (ancestor) to rightmost (target). */
  segments: SelectorSegment[];
  /** The original resolved selector string. */
  raw: string;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a single resolved CSS selector into a `SelectorChain`.
 *
 * Examples:
 *   ".parent .child"         → 2 segments, descendant combinator
 *   ".parent > .child"       → 2 segments, child combinator
 *   ".a + .b ~ .c"           → 3 segments with adjacent then sibling
 *   ".btn:hover"             → 1 segment with pseudo ":hover"
 *   "div.card#main[data-x]"  → 1 segment with tag, class, id, attribute
 */
export function parseSelectorToIR(resolved: string): SelectorChain {
  const segments: SelectorSegment[] = [];
  const tokens = tokenizeSelector(resolved);

  let current = makeSegment('root');

  for (const token of tokens) {
    switch (token.type) {
      case 'combinator': {
        // Flush current segment (only if it has content)
        if (hasContent(current)) {
          segments.push(current);
          current = makeSegment(token.combinator!);
        } else {
          // Update combinator if segment is still empty (e.g. leading whitespace)
          current.combinator = token.combinator!;
        }
        break;
      }
      case 'class':
        current.classes.push(token.value);
        break;
      case 'id':
        current.ids.push(token.value);
        break;
      case 'tag':
        current.tag = token.value;
        break;
      case 'attribute':
        current.attributes.push(token.value);
        break;
      case 'pseudo':
        current.pseudos.push(token.value);
        break;
    }
  }

  if (hasContent(current)) {
    segments.push(current);
  }

  return { segments, raw: resolved };
}

/**
 * Extract all class names that appear in the **target** (rightmost) segment
 * of a selector chain.  Useful for quick candidate filtering before
 * running the full structural match.
 */
export function getTargetClasses(chain: SelectorChain): string[] {
  if (chain.segments.length === 0) { return []; }
  return chain.segments[chain.segments.length - 1].classes;
}

/**
 * Extract *every* class name mentioned anywhere in the chain.
 */
export function getAllClasses(chain: SelectorChain): string[] {
  const out: string[] = [];
  for (const seg of chain.segments) {
    out.push(...seg.classes);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

interface Token {
  type: 'class' | 'id' | 'tag' | 'attribute' | 'pseudo' | 'combinator';
  value: string;
  combinator?: Combinator;
}

function tokenizeSelector(sel: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  function peek(): string { return pos < sel.length ? sel[pos] : ''; }
  function advance(): string { return sel[pos++]; }

  // Skip whitespace, returning true if any was skipped
  function skipWS(): boolean {
    let skipped = false;
    while (pos < sel.length && (sel[pos] === ' ' || sel[pos] === '\t')) {
      pos++;
      skipped = true;
    }
    return skipped;
  }

  function readIdent(): string {
    let start = pos;
    while (pos < sel.length && isIdentChar(sel[pos])) { pos++; }
    return sel.substring(start, pos);
  }

  while (pos < sel.length) {
    const ch = peek();

    // --- Combinators (explicit) ---
    if (ch === '>') {
      advance();
      skipWS();
      tokens.push({ type: 'combinator', value: '>', combinator: 'child' });
      continue;
    }
    if (ch === '+') {
      advance();
      skipWS();
      tokens.push({ type: 'combinator', value: '+', combinator: 'adjacent' });
      continue;
    }
    if (ch === '~') {
      advance();
      skipWS();
      tokens.push({ type: 'combinator', value: '~', combinator: 'sibling' });
      continue;
    }

    // --- Whitespace → descendant combinator ---
    if (ch === ' ' || ch === '\t') {
      skipWS();
      // Only emit descendant if not followed by an explicit combinator
      const next = peek();
      if (next && next !== '>' && next !== '+' && next !== '~' && next !== ')') {
        tokens.push({ type: 'combinator', value: ' ', combinator: 'descendant' });
      }
      continue;
    }

    // --- Class ---
    if (ch === '.') {
      advance();
      const name = readIdent();
      if (name) { tokens.push({ type: 'class', value: name }); }
      continue;
    }

    // --- ID ---
    if (ch === '#') {
      advance();
      const name = readIdent();
      if (name) { tokens.push({ type: 'id', value: name }); }
      continue;
    }

    // --- Attribute selector [...]  ---
    if (ch === '[') {
      let depth = 0;
      let start = pos;
      while (pos < sel.length) {
        if (sel[pos] === '[') { depth++; }
        if (sel[pos] === ']') { depth--; if (depth === 0) { pos++; break; } }
        pos++;
      }
      tokens.push({ type: 'attribute', value: sel.substring(start, pos) });
      continue;
    }

    // --- Pseudo-class / pseudo-element  :something  or  ::something ---
    if (ch === ':') {
      let start = pos;
      advance(); // first ':'
      if (peek() === ':') { advance(); } // '::'
      readIdent();
      // If followed by parentheses, consume them respecting nesting
      if (peek() === '(') {
        let depth = 0;
        while (pos < sel.length) {
          if (sel[pos] === '(') { depth++; }
          if (sel[pos] === ')') { depth--; if (depth === 0) { pos++; break; } }
          pos++;
        }
      }
      tokens.push({ type: 'pseudo', value: sel.substring(start, pos) });
      continue;
    }

    // --- Tag / element name ---
    if (isIdentStart(ch)) {
      const name = readIdent();
      if (name) { tokens.push({ type: 'tag', value: name }); }
      continue;
    }

    // --- Universal selector * ---
    if (ch === '*') {
      advance();
      tokens.push({ type: 'tag', value: '*' });
      continue;
    }

    // Skip unknown characters
    advance();
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSegment(combinator: Combinator): SelectorSegment {
  return { tag: '', classes: [], ids: [], attributes: [], pseudos: [], combinator };
}

function hasContent(seg: SelectorSegment): boolean {
  return seg.tag !== '' || seg.classes.length > 0 || seg.ids.length > 0
    || seg.attributes.length > 0 || seg.pseudos.length > 0;
}

function isIdentChar(ch: string): boolean {
  return /[\w-]/.test(ch);
}

function isIdentStart(ch: string): boolean {
  return /[a-zA-Z_]/.test(ch);
}
