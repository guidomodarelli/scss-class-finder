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
  const all: MatchResult[] = [];
  for (const ext of extractions) {
    all.push(...matchSelectorChain(chain, ext));
  }
  all.sort((a, b) => b.score - a.score);
  return all;
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
  const targetSeg = segments[segments.length - 1];

  // Verify target segment matches the node
  if (!segmentMatchesNode(targetSeg, targetNode)) {
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
    const seg = segments[i + 1]; // the segment whose combinator tells us the relationship
    const ancestorSeg = segments[i];
    const combinator = segments[i + 1].combinator;

    const found = findMatchingRelative(ancestorSeg, currentNode!, combinator);
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
  if (!seg.classes.every((cls) => node.classes.includes(cls))) {
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
  seg: SelectorSegment,
  fromNode: ViewNode,
  combinator: 'descendant' | 'child' | 'adjacent' | 'sibling' | 'root',
): ViewNode | null {
  switch (combinator) {
    case 'descendant':
      return findAncestor(seg, fromNode);
    case 'child':
      return findDirectParent(seg, fromNode);
    case 'adjacent':
      return findAdjacentSibling(seg, fromNode);
    case 'sibling':
      return findGeneralSibling(seg, fromNode);
    case 'root':
      return findAncestor(seg, fromNode);
  }
}

/** Walk up through ancestors at any depth. */
function findAncestor(seg: SelectorSegment, node: ViewNode): ViewNode | null {
  let current = node.parent;
  while (current) {
    if (segmentMatchesNode(seg, current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/** Only match direct parent. */
function findDirectParent(seg: SelectorSegment, node: ViewNode): ViewNode | null {
  if (node.parent && segmentMatchesNode(seg, node.parent)) {
    return node.parent;
  }
  return null;
}

/** Match the immediately preceding sibling (combinator `+`). */
function findAdjacentSibling(seg: SelectorSegment, node: ViewNode): ViewNode | null {
  if (!node.parent || node.siblingIndex === 0) { return null; }
  const prev = node.parent.children[node.siblingIndex - 1];
  if (prev && segmentMatchesNode(seg, prev)) {
    return prev;
  }
  return null;
}

/** Match any preceding sibling (combinator `~`). */
function findGeneralSibling(seg: SelectorSegment, node: ViewNode): ViewNode | null {
  if (!node.parent) { return null; }
  for (let i = node.siblingIndex - 1; i >= 0; i--) {
    const sib = node.parent.children[i];
    if (segmentMatchesNode(seg, sib)) {
      return sib;
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
  for (const cls of targetClasses) {
    const off = node.classOffsets.get(cls);
    if (off !== undefined) {
      return { line: node.line, column: node.column, offset: off };
    }
  }
  return { line: node.line, column: node.column, offset: node.offset };
}
