import type { Terminal } from "@xterm/xterm";

export type TerminalClipboardOptions = {
  /**
   * Called with the text the user just pasted via Ctrl/Cmd+V. Provide for
   * interactive terminals (forward to ws / stdin); omit for read-only
   * viewers — pasting will silently no-op there.
   */
  onPaste?: (text: string) => void;
};

/**
 * Wire Ctrl/Cmd+C (copy selection) and Ctrl/Cmd+V (paste — when `onPaste`
 * is provided) on an xterm.js Terminal.
 *
 * The Ctrl+Insert / Shift+Insert default xterm.js bindings are awkward and
 * unintuitive for users coming from any normal app, so every terminal in
 * Tokimo standardises on this familiar Ctrl/Cmd+C/V behaviour via this
 * helper instead of re-implementing the same handler in each component.
 *
 * Shift / Alt modifiers fall through to xterm's default handling, so
 * Ctrl+Shift+C (send SIGINT keeping selection) and Ctrl+Shift+V still
 * work as before.
 *
 * Copy:
 *   - only fires when there's an active selection (otherwise falls through
 *     so Ctrl+C still sends ETX / interrupts the running process)
 *   - writes to the system clipboard; clears the selection afterwards
 *
 * Paste:
 *   - only fires when `onPaste` is provided
 *   - reads from the system clipboard and forwards the text via `onPaste`
 *   - clipboard read can fail in non-secure contexts; we silently swallow
 *     the rejection (matches existing behaviour, nothing better to do).
 */
export function installTerminalClipboard(
  term: Terminal,
  options: TerminalClipboardOptions = {},
): void {
  const { onPaste } = options;

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") return true;

    const mod = event.ctrlKey || event.metaKey;
    if (!mod || event.altKey || event.shiftKey) return true;

    const key = event.key.toLowerCase();

    if (key === "c" && term.hasSelection()) {
      const text = term.getSelection();
      if (text) {
        navigator.clipboard?.writeText(text).catch(() => {
          // Clipboard API may be blocked (e.g. non-secure context); ignore.
        });
      }
      term.clearSelection();
      event.preventDefault();
      return false;
    }

    if (key === "v" && onPaste) {
      navigator.clipboard
        ?.readText()
        .then((text) => {
          if (text) onPaste(text);
        })
        .catch(() => {
          // Clipboard API may be blocked (e.g. non-secure context); ignore.
        });
      event.preventDefault();
      return false;
    }

    return true;
  });
}
