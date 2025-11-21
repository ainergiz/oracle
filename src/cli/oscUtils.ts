// Utilities for handling OSC progress codes embedded in stored logs.
const OSC_PROGRESS_PREFIX = '\u001b]9;4;';
const OSC_END = '\u001b\\';

/**
 * Optionally removes OSC 9;4 progress sequences (used by Ghostty/WezTerm to show progress bars).
 * Keep them when replaying to a real TTY; strip when piping to non-TTY outputs.
 */
export function sanitizeOscProgress(text: string, keepOsc: boolean): string {
  if (keepOsc) {
    return text;
  }
  let current = text;
  while (current.includes(OSC_PROGRESS_PREFIX)) {
    const start = current.indexOf(OSC_PROGRESS_PREFIX);
    const end = current.indexOf(OSC_END, start + OSC_PROGRESS_PREFIX.length);
    const cutEnd = end === -1 ? start + OSC_PROGRESS_PREFIX.length : end + OSC_END.length;
    current = `${current.slice(0, start)}${current.slice(cutEnd)}`;
  }
  return current;
}
