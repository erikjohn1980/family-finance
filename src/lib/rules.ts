/** Derive a merchant-rule substring pattern from a raw bank merchant string (store numbers removed). */
export function rulePatternFor(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/#?\d{2,}/g, " ")
    .replace(/[^a-z& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
