/**
 * XTerm.js log viewer component
 * Renders structured log entries as ANSI-colored text in a terminal emulator.
 * Used by SubscriptionLogViewer & DownloadLogViewer.
 */

import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

interface XTermLogViewerProps {
  /** Pre-formatted ANSI lines to render. Each entry = one logical log entry (may contain \r\n). */
  lines: string[];
  /** Whether the log is live (enables auto-scroll to bottom). */
  isLive?: boolean;
  /** CSS height. Default: calc(100vh - 380px) */
  height?: string;
  /** Minimum height in px. Default: 200 */
  minHeight?: number;
  /** Loading state — shows nothing if true */
  loading?: boolean;
  /** Show a running indicator at the bottom */
  showRunningIndicator?: boolean;
}

export default function XTermLogViewer({
  lines,
  isLive = false,
  height = "calc(100vh - 380px)",
  minHeight = 200,
  loading = false,
  showRunningIndicator = false,
}: XTermLogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const writtenCountRef = useRef(0);
  const userScrolledRef = useRef(false);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    let term: Terminal;
    let disposed = false;

    const init = async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");
      const { SearchAddon } = await import("@xterm/addon-search");

      if (disposed || !containerRef.current) return;

      term = new Terminal({
        theme: {
          background: "#09090b", // zinc-950
          foreground: "#e4e4e7", // zinc-200
          cursor: "#09090b", // hidden cursor
          selectionBackground: "#3f3f46", // zinc-700
          black: "#18181b",
          red: "#ef4444",
          green: "#22c55e",
          yellow: "#eab308",
          blue: "#3b82f6",
          magenta: "#a855f7",
          cyan: "#06b6d4",
          white: "#e4e4e7",
          brightBlack: "#71717a",
          brightRed: "#f87171",
          brightGreen: "#4ade80",
          brightYellow: "#facc15",
          brightBlue: "#60a5fa",
          brightMagenta: "#c084fc",
          brightCyan: "#22d3ee",
          brightWhite: "#fafafa",
        },
        fontSize: 13,
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        lineHeight: 1.4,
        scrollback: 10000,
        cursorBlink: false,
        cursorStyle: "bar",
        cursorWidth: 0,
        disableStdin: true,
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(
        new WebLinksAddon((_event, uri) => {
          window.open(uri, "_blank", "noopener,noreferrer");
        }),
      );
      term.loadAddon(new SearchAddon());

      term.open(containerRef.current);

      // Delay fit so the container has rendered dimensions
      requestAnimationFrame(() => {
        if (!disposed) {
          try {
            fitAddon.fit();
          } catch {
            // may fail if not yet visible
          }
        }
      });

      // Track user scroll
      term.onScroll(() => {
        if (!term) return;
        const buf = term.buffer.active;
        const isAtBottom =
          buf.baseY + buf.viewportY >= buf.baseY + term.rows - 2;
        userScrolledRef.current = !isAtBottom;
      });

      // Resize observer
      const ro = new ResizeObserver(() => {
        if (!disposed) {
          try {
            fitAddon.fit();
          } catch {
            // ignore
          }
        }
      });
      ro.observe(containerRef.current);

      termRef.current = term;
      writtenCountRef.current = 0;

      // Flush any lines that arrived before the terminal was ready
      const pending = linesRef.current;
      if (pending.length > 0) {
        for (const line of pending) {
          term.writeln(line);
        }
        writtenCountRef.current = pending.length;
      }
    };

    init();

    return () => {
      disposed = true;
      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }
      writtenCountRef.current = 0;
    };
  }, []);

  // Write new lines incrementally
  useEffect(() => {
    const term = termRef.current;
    if (!term || loading) return;

    const prevCount = writtenCountRef.current;
    if (lines.length <= prevCount) return;

    const newLines = lines.slice(prevCount);
    for (const line of newLines) {
      term.writeln(line);
    }
    writtenCountRef.current = lines.length;

    // Auto-scroll if live and user hasn't scrolled up
    if (isLive && !userScrolledRef.current) {
      term.scrollToBottom();
    }
  }, [lines, isLive, loading]);

  // Show running indicator
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    if (showRunningIndicator) {
      term.writeln("\x1b[34m⏳ running...\x1b[0m");
      if (!userScrolledRef.current) term.scrollToBottom();
    }
  }, [showRunningIndicator]);

  if (loading) {
    return (
      <div
        className="rounded-lg bg-zinc-950 flex items-center justify-center"
        style={{ height, minHeight }}
      >
        <div className="text-zinc-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="rounded-lg overflow-hidden [&_.xterm-viewport]:!overflow-y-auto"
      style={{ height, minHeight }}
    />
  );
}
