/**
 * Convert the limited markdown emitted for document change summaries into
 * user-facing plain text. This avoids showing raw markdown tokens in UI/PDFs
 * without introducing a full markdown renderer for this controlled content.
 */
export function stripSimpleMarkdown(input: string | null | undefined): string {
  if (!input) return '';

  return input
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      let cleaned = line.trimEnd();

      cleaned = cleaned
        // Markdown headings: "# Title" / "## Section" -> "Title" / "Section"
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        // Generated action bullets: "- [P1] Do thing" -> "P1: Do thing"
        .replace(/^\s*[-*]\s+\[([^\]]+)\]\s+/, '$1: ')
        // Other unordered bullets: "- Item" / "* Item" -> "Item"
        .replace(/^\s*[-*]\s+/, '')
        // Strong emphasis before italic emphasis so nested underscores are handled.
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        // Inline code formatting is not useful in change summaries.
        .replace(/`([^`]+)`/g, '$1');

      return cleaned;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
