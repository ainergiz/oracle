import { render as renderMarkdown } from 'markdansi';

export function renderMarkdownAnsi(markdown: string): string {
  try {
    const color = Boolean(process.stdout.isTTY);
    const width = process.stdout.columns;
    const hyperlinks = color; // enable OSC 8 only when we have color/TTY
    return renderMarkdown(markdown, {
      color,
      width,
      wrap: true,
      hyperlinks,
    });
  } catch {
    // Last-resort fallback: return the raw markdown so we never crash.
    return markdown;
  }
}
