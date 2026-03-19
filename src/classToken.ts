export interface ClassTokenMatch {
  value: string;
  start: number;
  end: number;
}

export function isClassTokenCharacter(character: string | undefined): boolean {
  return !!character && /[A-Za-z0-9_-]/.test(character);
}

export function findClassTokenAtOffset(text: string, offset: number): ClassTokenMatch | null {
  if (text.length === 0) {
    return null;
  }

  if (offset < 0 || offset > text.length) {
    return null;
  }

  let tokenOffset = offset;

  if (!isClassTokenCharacter(text[tokenOffset]) && isClassTokenCharacter(text[tokenOffset - 1])) {
    tokenOffset -= 1;
  }

  if (!isClassTokenCharacter(text[tokenOffset])) {
    return null;
  }

  let start = tokenOffset;
  while (start > 0 && isClassTokenCharacter(text[start - 1])) {
    start -= 1;
  }

  let end = tokenOffset + 1;
  while (end < text.length && isClassTokenCharacter(text[end])) {
    end += 1;
  }

  return {
    value: text.slice(start, end),
    start,
    end,
  };
}
