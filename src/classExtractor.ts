// ---------------------------------------------------------------------------
// Class Usage Extractor
// ---------------------------------------------------------------------------
// Parses HTML, JSX, and TSX files to extract CSS class names and their
// structural context (parent/child/sibling relationships).  Uses a
// lightweight regex + state-machine approach — no external AST library —
// so the extension stays zero-dependency.
// ---------------------------------------------------------------------------

/** Represents one node (element) in the view tree. */
export interface ViewNode {
  /** Tag name, e.g. "div", "span", "button". */
  tag: string;
  /** Class names applied to this node (without leading dot). */
  classes: string[];
  /** 0-based line where the opening tag starts. */
  line: number;
  /** 0-based column where the opening tag starts. */
  column: number;
  /** Byte offset in the source where the tag name starts. */
  offset: number;
  /** Parent node, null for root. */
  parent: ViewNode | null;
  /** Ordered list of child element nodes. */
  children: ViewNode[];
  /** Index among siblings (0-based). */
  siblingIndex: number;
  /** Per-class range info — maps class name → offset of that class token. */
  classOffsets: Map<string, number>;
}

export interface ExtractionResult {
  /** Flat list of all nodes with at least one class. */
  nodes: ViewNode[];
  /** Root-level nodes forming the tree. */
  roots: ViewNode[];
  /** Source file path (stored for reference, not used in matching). */
  filePath: string;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Extract class usage from a source file.
 *
 * @param text     Full source text of the file.
 * @param filePath Path for bookkeeping (not read from disk).
 * @param lang     Hint for parsing strategy.
 */
export function extractClassUsages(
  text: string,
  filePath: string,
  lang: 'html' | 'jsx' | 'tsx' | 'js' | 'ts',
): ExtractionResult {
  if (lang === 'html') {
    return extractFromHTML(text, filePath);
  }
  return extractFromJSX(text, filePath);
}

// ---------------------------------------------------------------------------
// HTML extraction
// ---------------------------------------------------------------------------

// Matches opening tags capturing: (1) tag name, (2) attributes blob
const OPEN_TAG_RE = /<([a-zA-Z][\w-]*)((?:\s[^>]*?)?)(\s*\/?)>/g;
const CLOSE_TAG_RE = /<\/([a-zA-Z][\w-]*)\s*>/g;
// class="..." or class='...'
const CLASS_ATTR_RE = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function extractFromHTML(text: string, filePath: string): ExtractionResult {
  const allNodes: ViewNode[] = [];
  const roots: ViewNode[] = [];
  const stack: ViewNode[] = [];

  // We'll walk through the text sequentially, handling open and close tags.
  const combined = /(<\/([a-zA-Z][\w-]*)\s*>)|(<([a-zA-Z][\w-]*)((?:\s[^>]*?)?)(\s*\/?)>)/g;
  let m: RegExpExecArray | null;

  while ((m = combined.exec(text)) !== null) {
    if (m[1]) {
      // Close tag
      const closeTag = m[2].toLowerCase();
      // Pop stack until we find a matching open tag
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === closeTag) {
          stack.splice(i);
          break;
        }
      }
    } else if (m[3]) {
      // Open tag
      const tagName = m[4].toLowerCase();
      const attrsBlob = m[5] || '';
      const selfClosing = (m[6] || '').includes('/');
      const tagOffset = m.index + 1; // offset of tag name (skip '<')
      const { line, column } = offsetToLC(text, m.index);

      const classes = extractClassesFromAttrs(attrsBlob);
      const classOffsets = buildClassOffsetMap(text, m.index, classes);

      const parent = stack.length > 0 ? stack[stack.length - 1] : null;
      const siblingIndex = parent ? parent.children.length : roots.length;

      const node: ViewNode = {
        tag: tagName,
        classes,
        line,
        column,
        offset: tagOffset,
        parent,
        children: [],
        siblingIndex,
        classOffsets,
      };

      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }

      if (classes.length > 0) {
        allNodes.push(node);
      }

      if (!selfClosing && !isVoidElement(tagName)) {
        stack.push(node);
      }
    }
  }

  return { nodes: allNodes, roots, filePath };
}

// ---------------------------------------------------------------------------
// JSX / TSX extraction
// ---------------------------------------------------------------------------

// Matches JSX opening tags: <Component ...> or <div ...>
const JSX_OPEN_TAG_RE = /(<([A-Za-z_][\w.]*)(\s[^>]*?)?(\s*\/?)>)/g;
const JSX_CLOSE_TAG_RE = /<\/([A-Za-z_][\w.]*)\s*>/g;

// className="..." | className={'...'} | className={`...`}
const CLASSNAME_LITERAL_RE = /\bclassName\s*=\s*(?:"([^"]*)"|'([^']*)'|\{['"]([^'"]*)['"]\}|\{\s*`([^`]*)`\s*\})/g;

// clsx(...) or classnames(...) with string literal arguments
const CLSX_RE = /\b(?:clsx|classnames|cx)\s*\(([^)]*)\)/g;

function extractFromJSX(text: string, filePath: string): ExtractionResult {
  const allNodes: ViewNode[] = [];
  const roots: ViewNode[] = [];
  const stack: ViewNode[] = [];

  const combined = /(<\/([A-Za-z_][\w.]*)\s*>)|(<([A-Za-z_][\w.]*)(\s[^>]*?)?(\s*\/?)>)/g;
  let m: RegExpExecArray | null;

  while ((m = combined.exec(text)) !== null) {
    if (m[1]) {
      // Close tag
      const closeTag = m[2];
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === closeTag) {
          stack.splice(i);
          break;
        }
      }
    } else if (m[3]) {
      // Open tag
      const tagName = m[4];
      const attrsBlob = m[5] || '';
      const selfClosing = (m[6] || '').includes('/');
      const tagOffset = m.index + 1;
      const { line, column } = offsetToLC(text, m.index);

      const classes = extractClassesFromJSXAttrs(attrsBlob);
      const classOffsets = buildClassOffsetMap(text, m.index, classes);

      const parent = stack.length > 0 ? stack[stack.length - 1] : null;
      const siblingIndex = parent ? parent.children.length : roots.length;

      const node: ViewNode = {
        tag: tagName,
        classes,
        line,
        column,
        offset: tagOffset,
        parent,
        children: [],
        siblingIndex,
        classOffsets,
      };

      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }

      if (classes.length > 0) {
        allNodes.push(node);
      }

      if (!selfClosing) {
        stack.push(node);
      }
    }
  }

  return { nodes: allNodes, roots, filePath };
}

// ---------------------------------------------------------------------------
// Attribute parsing helpers
// ---------------------------------------------------------------------------

function extractClassesFromAttrs(blob: string): string[] {
  const classes: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(CLASS_ATTR_RE.source, 'g');
  while ((m = re.exec(blob)) !== null) {
    const value = m[1] ?? m[2] ?? '';
    for (const cls of value.split(/\s+/)) {
      if (cls) { classes.push(cls); }
    }
  }
  return classes;
}

function extractClassesFromJSXAttrs(blob: string): string[] {
  const classes: string[] = [];

  // className="..." | className={'...'} | className={`...`}
  let m: RegExpExecArray | null;
  const re = new RegExp(CLASSNAME_LITERAL_RE.source, 'g');
  while ((m = re.exec(blob)) !== null) {
    const value = m[1] ?? m[2] ?? m[3] ?? m[4] ?? '';
    for (const cls of splitClassValue(value)) {
      if (cls) { classes.push(cls); }
    }
  }

  // clsx / classnames / cx
  const clsxRe = new RegExp(CLSX_RE.source, 'g');
  while ((m = clsxRe.exec(blob)) !== null) {
    const args = m[1];
    // Extract string literal arguments: 'foo', "bar"
    const strRe = /['"]([^'"]+)['"]/g;
    let sm: RegExpExecArray | null;
    while ((sm = strRe.exec(args)) !== null) {
      for (const cls of sm[1].split(/\s+/)) {
        if (cls) { classes.push(cls); }
      }
    }
    // Extract template literal static parts: `foo bar`
    const tmplRe = /`([^`]*)`/g;
    while ((sm = tmplRe.exec(args)) !== null) {
      // Remove ${...} expressions and split remaining parts
      const staticParts = sm[1].replace(/\$\{[^}]*\}/g, ' ');
      for (const cls of staticParts.split(/\s+/)) {
        if (cls) { classes.push(cls); }
      }
    }
  }

  return classes;
}

/**
 * Split a class attribute value, handling template-literal-like
 * interpolations by extracting only the static parts.
 */
function splitClassValue(value: string): string[] {
  // Remove ${...} interpolations (from template literals)
  const cleaned = value.replace(/\$\{[^}]*\}/g, ' ');
  return cleaned.split(/\s+/).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Offset helpers
// ---------------------------------------------------------------------------

function offsetToLC(text: string, offset: number): { line: number; column: number } {
  let line = 0;
  let lastNL = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lastNL = i;
    }
  }
  return { line, column: offset - lastNL - 1 };
}

/**
 * Build a map from class name → character offset of the first occurrence
 * of that class name within the tag region.
 */
function buildClassOffsetMap(
  text: string,
  tagStart: number,
  classes: string[],
): Map<string, number> {
  const map = new Map<string, number>();
  // Search region: from tagStart to the next '>'
  const endIdx = text.indexOf('>', tagStart);
  const region = text.substring(tagStart, endIdx >= 0 ? endIdx + 1 : tagStart + 500);

  for (const cls of classes) {
    if (map.has(cls)) { continue; }
    const idx = region.indexOf(cls);
    if (idx >= 0) {
      map.set(cls, tagStart + idx);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Void HTML elements (self-closing by spec)
// ---------------------------------------------------------------------------

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

function isVoidElement(tag: string): boolean {
  return VOID_ELEMENTS.has(tag);
}
