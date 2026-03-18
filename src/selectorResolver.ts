export interface SelectorInfo {
  /** 0-based line number where the selector text starts */
  line: number;
  /** Fully resolved CSS selector (e.g. ".bodyCard-header") */
  resolved: string;
  /** Raw SCSS selector as written in the source (e.g. "&-header") */
  raw: string;
}

/**
 * Split a selector list by commas, respecting parentheses so that
 * commas inside `:has()`, `:not()`, `:is()` etc. are not treated
 * as selector separators.
 */
export function splitSelectors(raw: string): string[] {
  const results: string[] = [];
  let current = '';
  let parenDepth = 0;

  for (const ch of raw) {
    if (ch === '(') { parenDepth++; }
    if (ch === ')') { parenDepth--; }
    if (ch === ',' && parenDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) { results.push(trimmed); }
      current = '';
    } else {
      current += ch;
    }
  }

  const trimmed = current.trim();
  if (trimmed) { results.push(trimmed); }
  return results;
}

/**
 * Parse an SCSS file's text and return every rule's resolved selector
 * together with its source line number.
 *
 * Handles:
 *  - `&`-based suffix/prefix concatenation  (`&-header`, `&.active`, `&:hover`)
 *  - Multi-level nesting                    (`&-main { &-uncollapsed }`)
 *  - Normal descendant nesting              (`.parent { .child }`)
 *  - Comma-separated selector lists         (`.a, .b { &-x }`)
 *  - `@media` / `@supports` / other at-rules (pass-through parent)
 *  - Line & block comments
 *  - Strings (single & double quoted)
 *  - `#{ }` interpolation (not mistaken for a block)
 *  - Selectors containing `:has()`, `:not()`, etc. with inner commas
 */
export function resolveSelectors(text: string): SelectorInfo[] {
  const results: SelectorInfo[] = [];

  let pos = 0;
  let line = 0;

  // Lexer state
  let inBlockComment = false;
  let inLineComment = false;
  let inString: string | null = null;
  let blockCommentAtSelectorStart = false;

  // Selector accumulation
  let selectorStart = 0;     // character offset where current selector text begins
  let selectorLine = 0;      // line of first non-WS char of current selector
  let seenNonWS = false;     // whether we've seen a non-whitespace char since last reset

  // Stack of resolved selectors per nesting depth.
  // Level 0 = root (virtual empty parent).
  const parentStack: string[][] = [['']];

  function resetSelector(from: number) {
    selectorStart = from;
    seenNonWS = false;
  }

  while (pos < text.length) {
    const ch = text[pos];
    const next = pos + 1 < text.length ? text[pos + 1] : '';

    // ---- strings (consume everything until closing quote) ----
    if (inString) {
      if (ch === '\n') { line++; }
      if (ch === inString && (pos === 0 || text[pos - 1] !== '\\')) {
        inString = null;
      }
      pos++;
      continue;
    }

    // ---- block comment ----
    if (inBlockComment) {
      if (ch === '\n') { line++; }
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        if (blockCommentAtSelectorStart) {
          resetSelector(pos + 2);
          blockCommentAtSelectorStart = false;
        }
        pos += 2;
      } else {
        pos++;
      }
      continue;
    }

    // ---- line comment ----
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        line++;
        pos++;
        resetSelector(pos);
      } else {
        pos++;
      }
      continue;
    }

    // ---- detect comment starts ----
    if (ch === '/' && next === '/') {
      inLineComment = true;
      pos += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockCommentAtSelectorStart = !seenNonWS;
      inBlockComment = true;
      pos += 2;
      continue;
    }

    // ---- detect string starts ----
    if (ch === '"' || ch === "'") {
      inString = ch;
      pos++;
      continue;
    }

    // ---- newlines ----
    if (ch === '\n') {
      line++;
      pos++;
      continue;
    }

    // ---- SCSS interpolation  #{...}  — don't treat inner braces as blocks ----
    if (ch === '#' && next === '{') {
      if (!seenNonWS) { seenNonWS = true; selectorLine = line; }
      pos += 2; // skip  #{
      let depth = 1;
      while (pos < text.length && depth > 0) {
        if (text[pos] === '{') { depth++; }
        if (text[pos] === '}') { depth--; }
        if (text[pos] === '\n') { line++; }
        pos++;
      }
      continue;
    }

    // ---- track first non-WS for selector line ----
    if (!seenNonWS && ch !== ' ' && ch !== '\t' && ch !== '\r') {
      seenNonWS = true;
      selectorLine = line;
    }

    // ---- opening brace  { ----
    if (ch === '{') {
      const rawSelector = text.substring(selectorStart, pos).trim();
      const isAtRule = rawSelector.startsWith('@');

      if (isAtRule) {
        // @media, @supports, @keyframes, etc. → keep parent unchanged
        parentStack.push(parentStack[parentStack.length - 1]);
      } else if (rawSelector.length > 0) {
        const parents = parentStack[parentStack.length - 1];
        const parts = splitSelectors(rawSelector);
        const resolved: string[] = [];

        for (const sel of parts) {
          if (sel.includes('&')) {
            for (const parent of parents) {
              resolved.push(sel.replace(/&/g, parent));
            }
          } else {
            for (const parent of parents) {
              resolved.push(parent === '' ? sel : `${parent} ${sel}`);
            }
          }
        }

        for (const r of resolved) {
          results.push({ line: selectorLine, resolved: r, raw: rawSelector });
        }

        parentStack.push(resolved);
      } else {
        // empty selector (e.g. bare block in a mixin body) — keep parent
        parentStack.push(parentStack[parentStack.length - 1]);
      }

      pos++;
      resetSelector(pos);
      continue;
    }

    // ---- closing brace  } ----
    if (ch === '}') {
      if (parentStack.length > 1) { parentStack.pop(); }
      pos++;
      resetSelector(pos);
      continue;
    }

    // ---- semicolon  ;  (end of declaration / @-statement) ----
    if (ch === ';') {
      pos++;
      resetSelector(pos);
      continue;
    }

    pos++;
  }

  return results;
}
