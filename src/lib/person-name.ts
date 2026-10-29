/** Normalize shouting/lowercase names without losing intentional spelling such as McDonald or initials. */
export function personName(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/[\p{L}\p{M}]+/gu, word => {
    if (/^(II|III|IV|VI|VII|VIII|IX)$/u.test(word)) return word;
    if (word !== word.toUpperCase() && word !== word.toLowerCase()) return word;
    const lower = word.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}
