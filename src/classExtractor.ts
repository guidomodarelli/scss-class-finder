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

export interface ExtractClassUsagesOptions {
  additionalClassNameHelpers?: string[];
}

export const DEFAULT_CLASS_NAME_HELPERS = [
  'clsx',
  'classnames',
  'cx',
  'clx',
  'cn',
  'cw',
];

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
  options: ExtractClassUsagesOptions = {},
): ExtractionResult {
  if (lang === 'html') {
    return extractFromHTML(text, filePath);
  }
  return extractFromJSX(text, filePath, options);
}

// ---------------------------------------------------------------------------
// HTML extraction
// ---------------------------------------------------------------------------

// class="..." or class='...'
const CLASS_ATTR_RE = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function extractFromHTML(text: string, filePath: string): ExtractionResult {
  const allNodes: ViewNode[] = [];
  const roots: ViewNode[] = [];
  const stack: ViewNode[] = [];

  // We'll walk through the text sequentially, handling open and close tags.
  const tagPattern = /(<\/([a-zA-Z][\w-]*)\s*>)|(<([a-zA-Z][\w-]*)((?:\s[^>]*?)?)(\s*\/?)>)/g;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagPattern.exec(text)) !== null) {
    if (tagMatch[1]) {
      // Close tag
      const closeTag = tagMatch[2].toLowerCase();
      // Pop stack until we find a matching open tag
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === closeTag) {
          stack.splice(i);
          break;
        }
      }
    } else if (tagMatch[3]) {
      // Open tag
      const tagName = tagMatch[4].toLowerCase();
      const attrsBlob = tagMatch[5] || '';
      const selfClosing = (tagMatch[6] || '').includes('/');
      const tagOffset = tagMatch.index + 1; // offset of tag name (skip '<')
      const { line, column } = offsetToLC(text, tagMatch.index);

      const classes = extractClassesFromAttrs(attrsBlob);
      const classOffsets = buildClassOffsetMap(text, tagMatch.index, classes);

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

// className="..." | className={'...'} | className={`...`}
const CLASSNAME_LITERAL_RE = /\bclassName\s*=\s*(?:"([^"]*)"|'([^']*)'|\{['"]([^'"]*)['"]\}|\{\s*`([^`]*)`\s*\})/g;

function normalizeClassNameHelpers(options: ExtractClassUsagesOptions): string[] {
  const mergedHelpers = [
    ...DEFAULT_CLASS_NAME_HELPERS,
    ...(options.additionalClassNameHelpers ?? []),
  ];

  return Array.from(new Set(
    mergedHelpers
      .map((helperName) => helperName.trim())
      .filter((helperName) => /^[A-Za-z_$][\w$]*$/.test(helperName)),
  ));
}

function buildClassNameHelperPattern(helperNames: string[]): RegExp | null {
  if (helperNames.length === 0) {
    return null;
  }

  const escapedHelperNames = helperNames.map((helperName) =>
    helperName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  return new RegExp(`\\b(?:${escapedHelperNames.join('|')})\\s*\\(([^)]*)\\)`, 'g');
}

function extractFromJSX(
  text: string,
  filePath: string,
  options: ExtractClassUsagesOptions,
): ExtractionResult {
  const allNodes: ViewNode[] = [];
  const roots: ViewNode[] = [];
  const stack: ViewNode[] = [];

  const tagPattern = /(<\/([A-Za-z_][\w.]*)\s*>)|(<([A-Za-z_][\w.]*)(\s[^>]*?)?(\s*\/?)>)/g;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagPattern.exec(text)) !== null) {
    if (tagMatch[1]) {
      // Close tag
      const closeTag = tagMatch[2];
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === closeTag) {
          stack.splice(i);
          break;
        }
      }
    } else if (tagMatch[3]) {
      // Open tag
      const tagName = tagMatch[4];
      const attrsBlob = tagMatch[5] || '';
      const selfClosing = (tagMatch[6] || '').includes('/');
      const tagOffset = tagMatch.index + 1;
      const { line, column } = offsetToLC(text, tagMatch.index);

      const classes = extractClassesFromJSXAttrs(attrsBlob, options);
      const classOffsets = buildClassOffsetMap(text, tagMatch.index, classes);

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
  let attributeMatch: RegExpExecArray | null;
  const classAttributePattern = new RegExp(CLASS_ATTR_RE.source, 'g');
  while ((attributeMatch = classAttributePattern.exec(blob)) !== null) {
    const value = attributeMatch[1] ?? attributeMatch[2] ?? '';
    for (const className of value.split(/\s+/)) {
      if (className) { classes.push(className); }
    }
  }
  return classes;
}

function extractClassesFromJSXAttrs(
  blob: string,
  options: ExtractClassUsagesOptions,
): string[] {
  const classes: string[] = [];

  // className="..." | className={'...'} | className={`...`}
  let attributeMatch: RegExpExecArray | null;
  const classNameLiteralPattern = new RegExp(CLASSNAME_LITERAL_RE.source, 'g');
  while ((attributeMatch = classNameLiteralPattern.exec(blob)) !== null) {
    const value = attributeMatch[1] ?? attributeMatch[2] ?? attributeMatch[3] ?? attributeMatch[4] ?? '';
    for (const className of splitClassValue(value)) {
      if (className) { classes.push(className); }
    }
  }

  const helperCallPattern = buildClassNameHelperPattern(normalizeClassNameHelpers(options));
  if (helperCallPattern) {
    while ((attributeMatch = helperCallPattern.exec(blob)) !== null) {
      const helperArguments = attributeMatch[1];
      // Extract string literal arguments: 'foo', "bar"
      const stringLiteralPattern = /['"]([^'"]+)['"]/g;
      let helperMatch: RegExpExecArray | null;
      while ((helperMatch = stringLiteralPattern.exec(helperArguments)) !== null) {
        for (const className of helperMatch[1].split(/\s+/)) {
          if (className) { classes.push(className); }
        }
      }
      // Extract template literal static parts: `foo bar`
      const templateLiteralPattern = /`([^`]*)`/g;
      while ((helperMatch = templateLiteralPattern.exec(helperArguments)) !== null) {
        // Remove ${...} expressions and split remaining parts
        const staticParts = helperMatch[1].replace(/\$\{[^}]*\}/g, ' ');
        for (const className of staticParts.split(/\s+/)) {
          if (className) { classes.push(className); }
        }
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
  const classOffsetByName = new Map<string, number>();
  // Search region: from tagStart to the next '>'
  const endIdx = text.indexOf('>', tagStart);
  const region = text.substring(tagStart, endIdx >= 0 ? endIdx + 1 : tagStart + 500);

  for (const className of classes) {
    if (classOffsetByName.has(className)) { continue; }
    const idx = region.indexOf(className);
    if (idx >= 0) {
      classOffsetByName.set(className, tagStart + idx);
    }
  }
  return classOffsetByName;
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
