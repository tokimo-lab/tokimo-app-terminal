/**
 * Terminal xterm/websocket session hook.
 * Manages xterm.js terminal initialization, WebSocket connection lifecycle,
 * theme sync, and resize handling.
 *
 * Preserves the direct xterm approach, dynamic imports, SSH_READY marker,
 * auto-cd on initial connect, and sendResize protocol.
 */

import type { Terminal } from "@xterm/xterm";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { installTerminalClipboard } from "@tokimo/terminal";
import { getTerminalTheme, type TerminalThemeId } from "@tokimo/terminal";
import { wsUrl } from "../api/client";

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export interface UseTerminalSessionOptions {
  /** SSH terminal config ID (uuid) */
  terminalId: string;
  /** Stable session ID (survives refreshes) */
  sessionIdRef: React.MutableRefObject<string>;
  /** Initial CWD for auto-cd on first connect (ref allows mutation) */
  initialCwdRef: React.MutableRefObject<string | null>;
  /** Terminal color scheme preference */
  terminalColorScheme: TerminalThemeId;
  /** App-level theme (light/dark) */
  appTheme: "light" | "dark";
}

export interface UseTerminalSessionResult {
  /** Container ref to attach xterm.js to */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Fit addon ref (for external resize triggers) */
  fitAddonRef: React.RefObject<{ fit: () => void } | null>;
  /** Connection status */
  status: ConnectionStatus;
  /** Manual reconnect handler */
  handleReconnect: () => void;
}

function getSshWsUrl(terminalId: string, sessionId: string): string {
  return wsUrl(
    `/connections/ws?id=${encodeURIComponent(terminalId)}&session_id=${encodeURIComponent(sessionId)}`,
  );
}

function sendResize(ws: WebSocket, cols: number, rows: number): void {
  ws.send(`\x01${JSON.stringify({ cols, rows })}`);
}

export function useTerminalSession({
  terminalId,
  sessionIdRef,
  initialCwdRef,
  terminalColorScheme,
  appTheme,
}: UseTerminalSessionOptions): UseTerminalSessionResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const initFnRef = useRef<(() => void) | null>(null);

  const resolvedThemeRef = useRef(getTerminalTheme(terminalColorScheme, appTheme));

  const handleReconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }
    fitAddonRef.current = null;
    setStatus("connecting");
    initFnRef.current?.();
  };

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let ws: WebSocket | null = null;

    const init = async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (disposed || !containerRef.current) return;

      containerRef.current.innerHTML = "";

      const term = new Terminal({
        allowTransparency: true,
        theme: resolvedThemeRef.current,
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

      // Ctrl/Cmd+C copy, Ctrl/Cmd+V paste (forwards to ws as PTY input).
      installTerminalClipboard(term, {
        onPaste: (text) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(new TextEncoder().encode(text));
          }
        },
      });

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      const url = getSshWsUrl(terminalId, sessionIdRef.current);
      ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        // Status stays "connecting" until we receive the SSH_READY marker.
        sendResize(ws!, term.cols, term.rows);
      };

      ws.onmessage = (ev: MessageEvent) => {
        if (disposed) return;
        if (ev.data instanceof ArrayBuffer) {
          const buf = new Uint8Array(ev.data);
          // Detect SSH_READY marker: "\x01SSH_READY\x01"
          if (
            buf.length === 11 &&
            buf[0] === 0x01 &&
            buf[10] === 0x01 &&
            new TextDecoder().decode(buf.subarray(1, 10)) === "SSH_READY"
          ) {
            setStatus("connected");
            term.focus();
            // If duplicated from another window, navigate to its directory once.
            const cwd = initialCwdRef.current;
            if (cwd && cwd !== "/") {
              initialCwdRef.current = null;
              setTimeout(() => {
                if (!disposed && ws!.readyState === WebSocket.OPEN) {
                  const escaped = `'${cwd.replace(/'/g, "'\\''")}' `;
                  ws!.send(new TextEncoder().encode(`cd ${escaped}\n`));
                }
              }, 100);
            }
            return;
          }
          term.write(buf);
        } else if (typeof ev.data === "string") {
          term.write(ev.data);
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        // If we never reached "connected", this is an auth/connection error.
        setStatus((prev) => (prev === "connecting" ? "error" : "disconnected"));
        term.write("\r\n\x1b[33m[连接已断开]\x1b[0m\r\n");
      };

      ws.onerror = () => {
        if (disposed) return;
        setStatus("error");
      };

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

      term.onResize(({ cols, rows }) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          sendResize(ws, cols, rows);
        }
      });

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
    };

    initFnRef.current = () => {
      disposed = false;
      init();
    };

    init();

    return () => {
      disposed = true;
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
  }, [terminalId, sessionIdRef, initialCwdRef]);

  // Sync xterm theme when app theme or terminal scheme changes (no reconnect)
  useEffect(() => {
    const resolved = getTerminalTheme(terminalColorScheme, appTheme);
    resolvedThemeRef.current = resolved;
    if (termRef.current) {
      termRef.current.options.theme = resolved;
    }
  }, [appTheme, terminalColorScheme]);

  return {
    containerRef,
    fitAddonRef,
    status,
    handleReconnect,
  };
}
