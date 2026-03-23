/**
 * SSH Terminal window component for use inside global task manager windows.
 *
 * Connects to the Rust backend via WebSocket which relays to an SSH session.
 * Uses xterm.js with fit/web-links addons.
 *
 * Layout:
 *  - Top bar: connection status + CPU/memory gauges
 *  - Center: xterm.js terminal
 *  - Bottom: resizable tabbed panel (文件 / 进程)
 */

import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";
import { FolderTree, HardDrive, ListTree } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWindowManager } from "../../contexts/WindowManagerContext";
import { api } from "../../generated/rust-api";
import type { SshHostStats } from "../../generated/rust-types/SshHostStats";
import SshFileTree from "./SshFileTree";
import SshProcessList from "./SshProcessList";
import SshStoragePanel from "./SshStoragePanel";
import { formatBytes } from "./ssh-terminal-utils";

interface SshTerminalWindowProps {
  /** SSH terminal config ID (uuid) */
  terminalId: string;
  /** Window manager window ID for metadata persistence */
  windowId: string;
}

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
type BottomTab = "files" | "processes" | "storage";

function getSshWsUrl(terminalId: string): string {
  const rustServer =
    (typeof window !== "undefined" &&
      (import.meta.env as Record<string, string>).RUST_SERVER) ||
    "";

  const base = rustServer
    ? rustServer.replace(/\/$/, "")
    : window.location.origin;

  const wsBase = base.replace(/^http:/, "ws:").replace(/^https:/, "wss:");

  return `${wsBase}/api/ssh-terminals/ws?id=${encodeURIComponent(terminalId)}`;
}

export default function SshTerminalWindow({
  terminalId,
  windowId,
}: SshTerminalWindowProps) {
  const { windows, updateMetadata } = useWindowManager();
  const win = windows.find((w) => w.id === windowId);
  const savedPanelHeight = (win?.metadata.sshPanelHeight as number) || 192;

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const initFnRef = useRef<(() => void) | null>(null);
  const [bottomTab, setBottomTab] = useState<BottomTab>("files");

  // ── Resizable bottom panel ──
  const [panelHeight, setPanelHeight] = useState(savedPanelHeight);
  const panelHeightRef = useRef(panelHeight);
  const draggingRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      const startY = e.clientY;
      const startH = panelHeight;

      const onMouseMove = (ev: MouseEvent) => {
        if (!draggingRef.current) return;
        const wrapper = wrapperRef.current;
        const maxH = wrapper ? wrapper.clientHeight - 100 : 600;
        const newH = Math.max(
          80,
          Math.min(startH + (startY - ev.clientY), maxH),
        );
        panelHeightRef.current = newH;
        setPanelHeight(newH);
      };

      const onMouseUp = () => {
        draggingRef.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        // Persist panel height to window metadata
        updateMetadata(windowId, { sshPanelHeight: panelHeightRef.current });
        // Re-fit terminal after resize
        try {
          fitAddonRef.current?.fit();
        } catch {
          // ignore
        }
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [panelHeight, windowId, updateMetadata],
  );

  // ── Host stats polling ──
  const [hostStats, setHostStats] = useState<SshHostStats | null>(null);

  useEffect(() => {
    if (status !== "connected") return;
    let cancelled = false;

    const fetchStats = async () => {
      try {
        const resp = await api.sshTerminal.stats.fetch({ id: terminalId });
        if (!cancelled) setHostStats(resp);
      } catch {
        // ignore — stats are best-effort
      }
    };

    fetchStats();
    const id = setInterval(fetchStats, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [terminalId, status]);

  const handleReconnect = useCallback(() => {
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
  }, []);

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
        theme: {
          background: "#09090b",
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

      const wsUrl = getSshWsUrl(terminalId);
      ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        setStatus("connected");
        sendResize(ws!, term.cols, term.rows);
        term.focus();
      };

      ws.onmessage = (ev: MessageEvent) => {
        if (disposed) return;
        if (ev.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(ev.data));
        } else if (typeof ev.data === "string") {
          term.write(ev.data);
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
  }, [terminalId]);

  const connected = status === "connected";

  const statusColor = connected
    ? "bg-green-500"
    : status === "connecting"
      ? "bg-yellow-500 animate-pulse"
      : status === "error"
        ? "bg-red-500"
        : "bg-zinc-500";

  const statusText = connected
    ? "已连接"
    : status === "connecting"
      ? "连接中..."
      : status === "error"
        ? "连接失败"
        : "已断开";

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full flex flex-col bg-[#09090b]"
    >
      {/* ── Top bar: status + CPU/memory gauges + reconnect ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${statusColor}`}
            />
            <span className="text-zinc-400">{statusText}</span>
          </div>

          {hostStats && connected && (
            <>
              <span className="text-zinc-600">|</span>
              <StatGauge
                label="CPU"
                percent={hostStats.cpuUsagePercent}
                color="emerald"
              />
              <StatGauge
                label="内存"
                percent={hostStats.memUsagePercent}
                color="blue"
                detail={`${formatBytes(hostStats.memUsedBytes)} / ${formatBytes(hostStats.memTotalBytes)}`}
              />
              {(hostStats.memBuffersBytes > 0 ||
                hostStats.memCachedBytes > 0) && (
                <span className="text-zinc-600 text-[10px]">
                  Buf {formatBytes(hostStats.memBuffersBytes)} / Cache{" "}
                  {formatBytes(hostStats.memCachedBytes)}
                </span>
              )}
              {hostStats.swapTotalBytes > 0 && (
                <StatGauge
                  label="Swap"
                  percent={
                    hostStats.swapTotalBytes > 0
                      ? (hostStats.swapUsedBytes / hostStats.swapTotalBytes) *
                        100
                      : 0
                  }
                  color="emerald"
                  detail={`${formatBytes(hostStats.swapUsedBytes)} / ${formatBytes(hostStats.swapTotalBytes)}`}
                />
              )}
            </>
          )}
        </div>
        {(status === "disconnected" || status === "error") && (
          <button
            type="button"
            onClick={handleReconnect}
            className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            重新连接
          </button>
        )}
      </div>

      {/* ── Terminal area ── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden [&_.xterm-viewport]:!overflow-y-auto"
      />

      {/* ── Drag handle ── */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag resize handle */}
      <div
        className="shrink-0 h-1 cursor-row-resize bg-zinc-800 hover:bg-zinc-600 active:bg-emerald-600 transition-colors"
        onMouseDown={handleDragStart}
      />

      {/* ── Bottom: tabbed panel ── */}
      <div
        className="shrink-0 bg-zinc-900/80 flex flex-col overflow-hidden"
        style={{ height: panelHeight }}
      >
        {/* Tab bar */}
        <div className="flex items-center shrink-0 border-b border-zinc-800/60">
          <TabButton
            active={bottomTab === "files"}
            onClick={() => setBottomTab("files")}
            icon={<FolderTree className="h-3 w-3" />}
            label="文件"
          />
          <TabButton
            active={bottomTab === "processes"}
            onClick={() => setBottomTab("processes")}
            icon={<ListTree className="h-3 w-3" />}
            label="进程"
          />
          <TabButton
            active={bottomTab === "storage"}
            onClick={() => setBottomTab("storage")}
            icon={<HardDrive className="h-3 w-3" />}
            label="存储"
          />
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {bottomTab === "files" ? (
            <SshFileTree terminalId={terminalId} connected={connected} />
          ) : bottomTab === "processes" ? (
            <SshProcessList terminalId={terminalId} connected={connected} />
          ) : (
            <SshStoragePanel terminalId={terminalId} connected={connected} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 px-3 py-1 text-xs transition-colors ${
        active
          ? "text-[var(--accent-text)] border-b-2 border-[var(--accent)] -mb-px"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function StatGauge({
  label,
  percent,
  color,
  detail,
}: {
  label: string;
  percent: number;
  color: "emerald" | "blue";
  detail?: string;
}) {
  const barColor =
    percent > 80
      ? "bg-red-500"
      : color === "emerald"
        ? "bg-emerald-500"
        : "bg-blue-500";

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-zinc-500">{label}</span>
      <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-500`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className="text-zinc-400 tabular-nums w-9 text-right">
        {percent.toFixed(0)}%
      </span>
      {detail && <span className="text-zinc-600 text-[10px]">{detail}</span>}
    </div>
  );
}

function sendResize(ws: WebSocket, cols: number, rows: number) {
  ws.send(`\x01${JSON.stringify({ cols, rows })}`);
}
