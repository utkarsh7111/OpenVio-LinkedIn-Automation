// Exactly the 15 reserved characters in LinkedIn's "little text format" grammar. The double quote is
// NOT reserved; escaping it would publish a visible backslash before every quotation mark.
const RESERVED = new Set<string>(['|', '{', '}', '@', '[', ']', '(', ')', '<', '>', '#', '\\', '*', '_', '~']);

/** Escape LinkedIn little-text reserved characters while preserving line breaks. */
export function escapeCommentary(text: string): string {
  return [...String(text)].map((character) => RESERVED.has(character) ? `\\${character}` : character).join('');
}
