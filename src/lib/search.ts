// The words of a search query, split as the API splits them (server/src/api/videos.rs). The search
// page finds the series of the library by their titles with them, in the browser.

/** The words of a query, separated by spaces, also by the wide space of Japanese text. */
export function searchWords(query: string): string[] {
  const text = query.trim();
  return text === "" ? [] : [...new Set(text.split(/\s+/u))];
}

/** Whether a text contains every one of the words, ignoring case. */
export function containsEvery(text: string, words: readonly string[]): boolean {
  const lowered = text.toLowerCase();
  return words.every((word) => lowered.includes(word.toLowerCase()));
}
