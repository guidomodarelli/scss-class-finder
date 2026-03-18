// ---------------------------------------------------------------------------
// Structural Matcher
// ---------------------------------------------------------------------------
// Matches a SelectorChain (from selectorIR) against a ViewNode tree (from
// classExtractor), respecting combinators: descendant, child, adjacent,
// sibling.  Returns scored results ordered by structural precision.
// ---------------------------------------------------------------------------

import { SelectorChain, SelectorSegment, getTargetClasses } from './selectorIR';
import { ViewNode, ExtractionResult } from './classExtractor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MatchConfidence = 'exact' | 'structural' | 'partial' | 'probable';

export interface MatchResult {
  /** The matched view node (target element). */
  node: ViewNode;
  /** Source file path. */
  filePath: string;
  /** 0-based line of the best class token match. */
  line: number;
  /** 0-based column of the best class token match. */
  column: number;
  /** Byte offset for precise cursor placement. */
  offset: number;
  /** How confident we are in the structural match. */
  confidence: MatchConfidence;
  /** Numeric score (higher = better). */
  score: number;
  /** Human-readable explanation. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Find all nodes in `extraction` that match the given `chain`.
 * Results are sorted by score descending.
 */
export function matchSelectorChain(
  chain: SelectorChain,
  extraction: ExtractionResult,
): MatchResult[] {
  const results: MatchResult[] = [];

  if (chain.segments.length === 0) { return results; }

  const targetClasses = getTargetClasses(chain);
  if (targetClasses.length === 0) { return results; }

  // Quick filter: only consider nodes that have ALL target-segment classes
  const candidates = extraction.nodes.filter((node) =>
    targetClasses.every((cls) => node.classes.includes(cls)),
  );

  for (const node of candidates) {
    const match = tryMatch(chain, node);
    if (match) {
      const { line, column, offset } = bestPosition(node, targetClasses);
      results.push({
        node,
        filePath: extraction.filePath,
        line,
        column,
        offset,
        ...match,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Convenience: match against multiple extraction results (multiple files).
 */
export function matchSelectorChainMulti(
  chain: SelectorChain,
  extractions: ExtractionResult[],
): MatchResult[] {
  const allMatches: MatchResult[] = [];
  for (const extractionResult of extractions) {
    allMatches.push(...matchSelectorChain(chain, extractionResult));
  }
  allMatches.sort((a, b) => b.score - a.score);
  return allMatches;
}

// ---------------------------------------------------------------------------
// Core matching algorithm
// ---------------------------------------------------------------------------

interface MatchInfo {
  confidence: MatchConfidence;
  score: number;
  reason: string;
}

function tryMatch(chain: SelectorChain, targetNode: ViewNode): MatchInfo | null {
  const segments = chain.segments;
  const targetSegment = segments[segments.length - 1];

  // Verify target segment matches the node
  if (!segmentMatchesNode(targetSegment, targetNode)) {
    return null;
  }

  // If selector has only one segment → exact class match
  if (segments.length === 1) {
    return {
      confidence: 'exact',
      score: 100,
      reason: `Exact class match: ${chain.raw}`,
    };
  }

  // Walk backwards through segments, verifying structural relationships
  let currentNode: ViewNode | null = targetNode;
  let matchedSegments = 1; // target already matched

  for (let i = segments.length - 2; i >= 0; i--) {
    const ancestorSegment = segments[i];
    const combinator = segments[i + 1].combinator;

    const found = findMatchingRelative(ancestorSegment, currentNode!, combinator);
    if (found) {
      currentNode = found;
      matchedSegments++;
    } else {
      break;
    }
  }

  const totalSegments = segments.length;
  const ratio = matchedSegments / totalSegments;

  if (ratio === 1) {
    return {
      confidence: 'structural',
      score: 90 + (totalSegments * 2), // reward deeper structural matches
      reason: `Full structural match: ${chain.raw}`,
    };
  }

  if (ratio >= 0.5) {
    return {
      confidence: 'partial',
      score: 40 + Math.round(ratio * 40),
      reason: `Partial structural match (${matchedSegments}/${totalSegments} segments): ${chain.raw}`,
    };
  }

  // Target class matched but almost no structural context verified
  return {
    confidence: 'probable',
    score: 20 + Math.round(ratio * 20),
    reason: `Class match with weak structural context (${matchedSegments}/${totalSegments}): ${chain.raw}`,
  };
}

// ---------------------------------------------------------------------------
// Segment ↔ Node matching
// ---------------------------------------------------------------------------

function segmentMatchesNode(seg: SelectorSegment, node: ViewNode): boolean {
  // All classes in the segment must be present on the node
  if (!seg.classes.every((className) => node.classes.includes(className))) {
    return false;
  }

  // Tag, if specified and not universal
  if (seg.tag && seg.tag !== '*' && seg.tag !== node.tag.toLowerCase()) {
    return false;
  }

  // IDs — we don't extract IDs from markup yet, so skip if present
  // (they're recorded but we can't verify; don't fail)

  return true;
}

// ---------------------------------------------------------------------------
// Structural relationship verification
// ---------------------------------------------------------------------------

/**
 * Starting from `fromNode`, find a relative that matches `seg` according
 * to `combinator`.
 */
function findMatchingRelative(
  segment: SelectorSegment,
  fromNode: ViewNode,
  combinator: 'descendant' | 'child' | 'adjacent' | 'sibling' | 'root',
): ViewNode | null {
  switch (combinator) {
    case 'descendant':
      return findAncestor(segment, fromNode);
    case 'child':
      return findDirectParent(segment, fromNode);
    case 'adjacent':
      return findAdjacentSibling(segment, fromNode);
    case 'sibling':
      return findGeneralSibling(segment, fromNode);
    case 'root':
      return findAncestor(segment, fromNode);
  }
}

/** Walk up through ancestors at any depth. */
function findAncestor(segment: SelectorSegment, node: ViewNode): ViewNode | null {
  let current = node.parent;
  while (current) {
    if (segmentMatchesNode(segment, current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/** Only match direct parent. */
function findDirectParent(segment: SelectorSegment, node: ViewNode): ViewNode | null {
  if (node.parent && segmentMatchesNode(segment, node.parent)) {
    return node.parent;
  }
  return null;
}

/** Match the immediately preceding sibling (combinator `+`). */
function findAdjacentSibling(segment: SelectorSegment, node: ViewNode): ViewNode | null {
  if (!node.parent || node.siblingIndex === 0) { return null; }
  const previousSibling = node.parent.children[node.siblingIndex - 1];
  if (previousSibling && segmentMatchesNode(segment, previousSibling)) {
    return previousSibling;
  }
  return null;
}

/** Match any preceding sibling (combinator `~`). */
function findGeneralSibling(segment: SelectorSegment, node: ViewNode): ViewNode | null {
  if (!node.parent) { return null; }
  for (let i = node.siblingIndex - 1; i >= 0; i--) {
    const siblingNode = node.parent.children[i];
    if (segmentMatchesNode(segment, siblingNode)) {
      return siblingNode;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

/**
 * Return the best position for cursor placement — prefer the offset
 * of the first target class in the class attribute.
 */
function bestPosition(
  node: ViewNode,
  targetClasses: string[],
): { line: number; column: number; offset: number } {
  for (const className of targetClasses) {
    const classOffset = node.classOffsets.get(className);
    if (classOffset !== undefined) {
      return { line: node.line, column: node.column, offset: classOffset };
    }
  }
  return { line: node.line, column: node.column, offset: node.offset };
}
