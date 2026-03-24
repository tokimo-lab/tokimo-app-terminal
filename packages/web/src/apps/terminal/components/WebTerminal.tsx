/**
 * Interactive web terminal backed by a WebSocket PTY session on the Rust server.
 * Uses xterm.js v6 with fit/web-links/search addons.
 *
 * Session persistence: the backend keeps the PTY alive across WS disconnects.
 * The session_id is stored in sessionStorage so page refreshes reconnect to
 * the same shell with scrollback replay.
 */

import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

const SESSION_STORAGE_KEY = "tokimo-terminal-session-id";

interface WebTerminalProps {
  /** WebSocket URL for the PTY endpoint, e.g. ws://localhost:5678/api/terminal/ws */
  wsUrl: string;
  /** CSS height. Default: 100% */
  height?: string;
  /** Minimum height in px. Default: 300 */
  minHeight?: number;
  /** Remove border, rounded corners for embedding. Default: false */
  borderless?: boolean;
}

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export default function WebTerminal({
  wsUrl,
  height = "100%",
  minHeight = 300,
  borderless = false,
}: WebTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let ws: WebSocket | null = null;

    const init = async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        allowTransparency: true,
        theme: {
          background: "rgba(0, 0, 0, 0)",
          foreground: "#e4e4e7",
          cursor: "#a1a1aa",
          cursorAccent: "#09090b",
          selectionBackground: "#3f3f46",
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
        fontSize: 14,
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        lineHeight: 1.3,
        scrollback: 10000,
        cursorBlink: true,
        cursorStyle: "block",
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(
        new WebLinksAddon((_event, uri) => {
          window.open(uri, "_blank", "noopener,noreferrer");
        }),
      );

      term.open(containerRef.current);

      requestAnimationFrame(() => {
        if (!disposed) {
          try {
            fitAddon.fit();
          } catch {
            // container may not have dimensions yet
          }
        }
      });

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // ── WebSocket connection ──────────────────────────────────────────
      const savedSession = sessionStorage.getItem(SESSION_STORAGE_KEY);
      const connectUrl = savedSession
        ? `${wsUrl}${wsUrl.includes("?") ? "&" : "?"}session_id=${encodeURIComponent(savedSession)}`
        : wsUrl;

      ws = new WebSocket(connectUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        setStatus("connected");
        // Send initial terminal size
        sendResize(ws!, term.cols, term.rows);
        term.focus();
      };

      ws.onmessage = (ev: MessageEvent) => {
        if (disposed) return;
        if (typeof ev.data === "string") {
          // Control message: \x02 prefix = session_id assignment
          if (ev.data.startsWith("\x02")) {
            const sid = ev.data.slice(1);
            sessionStorage.setItem(SESSION_STORAGE_KEY, sid);
            return;
          }
          term.write(ev.data);
        } else if (ev.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(ev.data));
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus("disconnected");
        term.write("\r\n\x1b[33m[连接已断开]\x1b[0m\r\n");
      };

      ws.onerror = () => {
        if (disposed) return;
        setStatus("error");
      };

      // Terminal input → WebSocket
      term.onData((data: string) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(data));
        }
      });

      term.onBinary((data: string) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          const buf = new Uint8Array(data.length);
          for (let i = 0; i < data.length; i++) {
            buf[i] = data.charCodeAt(i);
          }
          ws.send(buf);
        }
      });

      // Resize handling
      term.onResize(({ cols, rows }) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          sendResize(ws, cols, rows);
        }
      });

      // ResizeObserver to re-fit when container size changes
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
      roRef.current = ro;
    };

    init();

    return () => {
      disposed = true;
      if (roRef.current) {
        roRef.current.disconnect();
        roRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }
      fitAddonRef.current = null;
    };
  }, [wsUrl]);

  return (
    <div className={`relative ${borderless ? "flex h-full flex-col" : ""}`}>
      {!borderless && (
        <div className="absolute top-2 right-3 z-10 flex items-center gap-1.5 text-xs">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              status === "connected"
                ? "bg-green-500"
                : status === "connecting"
                  ? "bg-yellow-500 animate-pulse"
                  : status === "error"
                    ? "bg-red-500"
                    : "bg-zinc-500"
            }`}
          />
          <span className="text-zinc-400">
            {status === "connected"
              ? "已连接"
              : status === "connecting"
                ? "连接中..."
                : status === "error"
                  ? "连接失败"
                  : "已断开"}
          </span>
        </div>
      )}
      <div
        ref={containerRef}
        className={`overflow-hidden [&_.xterm-viewport]:!overflow-y-auto [&_.xterm-viewport]:!bg-transparent [&_.xterm]:!bg-transparent [&_.xterm]:!p-0 ${borderless ? "min-h-0 flex-1" : "rounded-lg border border-zinc-800"}`}
        style={borderless ? undefined : { height, minHeight }}
      />
    </div>
  );
}

function sendResize(ws: WebSocket, cols: number, rows: number) {
  // Control message: \x01 prefix + JSON
  ws.send(`\x01${JSON.stringify({ cols, rows })}`);
}
