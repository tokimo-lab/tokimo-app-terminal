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
import {
  Container,
  CopyPlus,
  FolderTree,
  HardDrive,
  ListTree,
  Network,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/generated/rust-api";
import type { SshHostStats } from "@/generated/rust-types/SshHostStats";
import { devWsBase } from "@/lib/server-base";
import { useComponentPreference } from "@/lib/use-preference";
import { randomUUID } from "@/lib/uuid";
import {
  useThemeCore,
  useWindowActions,
  useWindowActive,
  useWindowState,
} from "@/system";
import SshDockerPanel from "./SshDockerPanel";
import type { UploadItem, UploadQueue } from "./SshFileTree";
import SshFileTree from "./SshFileTree";
import SshNetworkPanel from "./SshNetworkPanel";
import SshProcessList from "./SshProcessList";
import SshStoragePanel from "./SshStoragePanel";
import { formatBytes } from "./ssh-terminal-utils";
import { getTerminalTheme, type TerminalThemeId } from "./terminal-themes";

interface SshTerminalWindowProps {
  /** SSH terminal config ID (uuid) */
  terminalId: string;
  /** Window manager window ID for metadata persistence (optional when embedded) */
  windowId?: string;
  /** Stable session ID provided externally (used when embedded without a window) */
  initialSessionId?: string;
  /** Connection label for display (e.g. "root@10.0.0.1"), used when no window title */
  connectionLabel?: string;
}

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
type BottomTab = "files" | "processes" | "storage" | "network" | "docker";

function getSshWsUrl(terminalId: string, sessionId: string): string {
  return `${devWsBase()}/api/ssh-terminals/ws?id=${encodeURIComponent(terminalId)}&session_id=${encodeURIComponent(sessionId)}`;
}

export default function SshTerminalWindow({
  terminalId,
  windowId,
  initialSessionId,
  connectionLabel: connectionLabelProp,
}: SshTerminalWindowProps) {
  const { windows } = useWindowState();
  const { openWindow, updateMetadata } = useWindowActions();
  const { theme } = useThemeCore();
  const terminalPref = useComponentPreference("terminal");
  const terminalColorScheme = ((
    terminalPref.data?.theme as Record<string, unknown>
  )?.colorScheme ?? "auto") as TerminalThemeId;
  const resolvedThemeRef = useRef(getTerminalTheme(terminalColorScheme, theme));
  const win = windowId ? windows.find((w) => w.id === windowId) : undefined;
  const savedPanelHeight = win?.metadata.sshPanelHeight || 192;
  const savedPanelCollapsed = win?.metadata.sshPanelCollapsed ?? false;

  // ── Session ID: stable UUID that survives page refreshes via metadata ──
  // Use the one already persisted in metadata, or generate a new one on first open.
  const sessionIdRef = useRef<string>(
    win?.metadata.sshSessionId || initialSessionId || randomUUID(),
  );
  // Persist once on first render if it wasn't already in metadata.
  const sessionIdPersisted = useRef(false);
  if (!sessionIdPersisted.current && win && windowId) {
    sessionIdPersisted.current = true;
    if (!win.metadata.sshSessionId) {
      updateMetadata(windowId, { sshSessionId: sessionIdRef.current });
    }
  }

  // ── Initial CWD: send a `cd` command once after first connect ──
  // Set from metadata when duplicating a session so the new shell lands in the
  // same directory the file browser was showing in the source window.
  const initialCwdRef = useRef<string | null>(
    win?.metadata.sshInitialCwd ?? null,
  );
  // Track the file-browser's current directory so Duplicate can carry it over.
  const fileBrowserPathRef = useRef<string>("/");
  const handleFileBrowserPathChange = useCallback(
    (p: string) => {
      fileBrowserPathRef.current = p;
      if (windowId) updateMetadata(windowId, { sshInitialCwd: p });
    },
    [windowId, updateMetadata],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const initFnRef = useRef<(() => void) | null>(null);
  const [bottomTab, setBottomTab] = useState<BottomTab>("files");
  const [panelCollapsed, setPanelCollapsed] = useState(savedPanelCollapsed);

  // ── Upload queue ──
  const [uploadQueue, setUploadQueue] = useState<UploadQueue>([]);

  const handleUploadFiles = useCallback(
    (targetDir: string, files: File[]) => {
      // Enqueue all selected files
      const newItems: UploadItem[] = files.map((f) => ({
        id: randomUUID(),
        filename: f.name,
        size: f.size,
        loaded: 0,
        status: "pending",
      }));
      setUploadQueue((prev) => [...prev, ...newItems]);

      // Upload each file sequentially (not in parallel to avoid server overload)
      const uploadOne = async (item: UploadItem, file: File) => {
        // Mark as uploading
        setUploadQueue((prev) =>
          prev.map((u) =>
            u.id === item.id ? { ...u, status: "uploading" } : u,
          ),
        );

        try {
          const url = api.sshTerminal.uploadUrl({
            id: terminalId,
            path: targetDir,
            filename: file.name,
          });

          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", url);
            xhr.withCredentials = true;

            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                setUploadQueue((prev) =>
                  prev.map((u) =>
                    u.id === item.id ? { ...u, loaded: e.loaded } : u,
                  ),
                );
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
              } else {
                reject(new Error(`HTTP ${xhr.status}`));
              }
            };

            xhr.onerror = () => reject(new Error("network error"));

            const formData = new FormData();
            formData.append("file", file);
            xhr.send(formData);
          });

          setUploadQueue((prev) =>
            prev.map((u) =>
              u.id === item.id ? { ...u, status: "done", loaded: u.size } : u,
            ),
          );
        } catch (err) {
          setUploadQueue((prev) =>
            prev.map((u) =>
              u.id === item.id
                ? {
                    ...u,
                    status: "error",
                    error: err instanceof Error ? err.message : "上传失败",
                  }
                : u,
            ),
          );
        }
      };

      // Run all uploads in parallel (XHR-based, non-blocking)
      for (let i = 0; i < newItems.length; i++) {
        uploadOne(newItems[i], files[i]);
      }
    },
    [terminalId],
  );

  /** Count of active (non-finished) uploads for the badge. */
  const activeUploadCount = uploadQueue.filter(
    (u) => u.status === "pending" || u.status === "uploading",
  ).length;

  // ── Resizable bottom panel ──
  const [panelHeight, setPanelHeight] = useState(savedPanelHeight);
  const panelHeightRef = useRef(panelHeight);
  const draggingRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleToggleCollapse = useCallback(() => {
    const newCollapsed = !panelCollapsed;
    setPanelCollapsed(newCollapsed);
    if (windowId) updateMetadata(windowId, { sshPanelCollapsed: newCollapsed });
    requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // ignore
      }
    });
  }, [panelCollapsed, windowId, updateMetadata]);

  const handleTabButtonClick = useCallback(
    (tab: BottomTab) => {
      setBottomTab(tab);
      if (panelCollapsed) {
        setPanelCollapsed(false);
        if (windowId) updateMetadata(windowId, { sshPanelCollapsed: false });
        requestAnimationFrame(() => {
          try {
            fitAddonRef.current?.fit();
          } catch {
            // ignore
          }
        });
      }
    },
    [panelCollapsed, windowId, updateMetadata],
  );

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
        if (windowId)
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
  const windowActive = useWindowActive();

  useEffect(() => {
    if (status !== "connected" || !windowActive) return;
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
  }, [terminalId, status, windowActive]);

  const handleDuplicate = useCallback(() => {
    // Open a fresh, independent session that starts in the file browser's
    // current directory (auto-cd on connect).
    openWindow({
      type: "terminal",
      title: win?.title || connectionLabelProp || terminalId,
      route: `/terminals/${terminalId}`,
      appId: win?.appId,
      sourceType: win?.sourceType ?? "ssh_terminal",
      sourceId: win?.sourceId ?? terminalId,
      metadata: {
        sshTerminalId: terminalId,
        sshHost: win?.metadata.sshHost,
        sshFileSystemId: win?.metadata.sshFileSystemId,
        sshSessionId: randomUUID(),
        sshInitialCwd: fileBrowserPathRef.current,
      },
    });
  }, [openWindow, terminalId, win, connectionLabelProp]);

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

      // Ctrl+C (copy when selected) / Ctrl+V (paste from clipboard)
      term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.type !== "keydown" || !event.ctrlKey || event.shiftKey)
          return true;
        if (event.key === "c" && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          term.clearSelection();
          return false;
        }
        if (event.key === "v") {
          navigator.clipboard.readText().then((text) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(new TextEncoder().encode(text));
            }
          });
          return false;
        }
        return true;
      });

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      const wsUrl = getSshWsUrl(terminalId, sessionIdRef.current);
      ws = new WebSocket(wsUrl);
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
  }, [terminalId]);

  // Sync xterm theme when app theme or terminal scheme changes (no reconnect)
  useEffect(() => {
    const resolved = getTerminalTheme(terminalColorScheme, theme);
    resolvedThemeRef.current = resolved;
    if (termRef.current) {
      termRef.current.options.theme = resolved;
    }
  }, [theme, terminalColorScheme]);

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
    <div ref={wrapperRef} className="relative h-full w-full flex flex-col">
      {/* ── Top bar: status + CPU/memory gauges + reconnect ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-black/[0.04] dark:bg-zinc-900/40 border-b border-black/[0.08] dark:border-zinc-800/60 shrink-0 select-none">
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${statusColor}`}
            />
            <span className="text-zinc-500 dark:text-zinc-400">
              {statusText}
            </span>
          </div>

          {hostStats && connected && (
            <>
              <span className="text-zinc-500 dark:text-zinc-500">|</span>
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
                <span className="text-zinc-500 dark:text-zinc-500 text-[10px]">
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
        <div className="flex items-center gap-2">
          {(status === "disconnected" || status === "error") && (
            <button
              type="button"
              onClick={handleReconnect}
              className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              重新连接
            </button>
          )}
          <button
            type="button"
            onClick={handleDuplicate}
            title="复制会话"
            className="flex items-center justify-center h-5 w-5 rounded text-zinc-500 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/[0.08] dark:hover:bg-zinc-700/60 transition-colors"
          >
            <CopyPlus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Terminal area ── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden p-2 [&_.xterm-viewport]:!overflow-y-auto [&_.xterm-viewport]:!bg-transparent [&_.xterm]:!bg-transparent"
      />

      {/* ── Drag handle ── */}
      {connected && !panelCollapsed && (
        // biome-ignore lint/a11y/noStaticElementInteractions: drag resize handle
        <div
          className="shrink-0 h-1 cursor-row-resize bg-black/[0.06] dark:bg-zinc-800/60 hover:bg-black/[0.10] dark:hover:bg-zinc-600/60 active:bg-emerald-600/80 transition-colors"
          onMouseDown={handleDragStart}
        />
      )}

      {/* ── Bottom: tabbed panel (hidden until connected) ── */}
      {connected && (
        <div
          className="shrink-0 bg-black/[0.04] dark:bg-zinc-900/40 flex flex-col overflow-hidden"
          style={panelCollapsed ? undefined : { height: panelHeight }}
        >
          {/* Tab bar — click blank area to collapse/expand */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: drag/click area */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: collapse toggle, keyboard not needed */}
          <div
            className="flex items-center shrink-0 border-b border-black/[0.06] dark:border-zinc-800/40 cursor-pointer select-none"
            onClick={handleToggleCollapse}
          >
            <TabButton
              active={bottomTab === "files"}
              collapsed={panelCollapsed}
              onClick={(e) => {
                e.stopPropagation();
                handleTabButtonClick("files");
              }}
              icon={<FolderTree className="h-3 w-3" />}
              label="文件"
              badge={activeUploadCount > 0 ? activeUploadCount : undefined}
            />
            <TabButton
              active={bottomTab === "processes"}
              collapsed={panelCollapsed}
              onClick={(e) => {
                e.stopPropagation();
                handleTabButtonClick("processes");
              }}
              icon={<ListTree className="h-3 w-3" />}
              label="进程"
            />
            <TabButton
              active={bottomTab === "storage"}
              collapsed={panelCollapsed}
              onClick={(e) => {
                e.stopPropagation();
                handleTabButtonClick("storage");
              }}
              icon={<HardDrive className="h-3 w-3" />}
              label="存储"
            />
            <TabButton
              active={bottomTab === "network"}
              collapsed={panelCollapsed}
              onClick={(e) => {
                e.stopPropagation();
                handleTabButtonClick("network");
              }}
              icon={<Network className="h-3 w-3" />}
              label="网络"
            />
            <TabButton
              active={bottomTab === "docker"}
              collapsed={panelCollapsed}
              onClick={(e) => {
                e.stopPropagation();
                handleTabButtonClick("docker");
              }}
              icon={<Container className="h-3 w-3" />}
              label="Docker"
            />
            {/* flex-1 spacer makes the rest of the bar clickable */}
            <div className="flex-1" />
          </div>

          {/* Tab content - hidden when collapsed */}
          {!panelCollapsed && (
            <div className="flex-1 overflow-hidden">
              {bottomTab === "files" ? (
                <SshFileTree
                  terminalId={terminalId}
                  connected={connected}
                  uploadQueue={uploadQueue}
                  onUploadFiles={handleUploadFiles}
                  connectionLabel={win?.title ?? connectionLabelProp}
                  initialPath={win?.metadata.sshInitialCwd}
                  onPathChange={handleFileBrowserPathChange}
                />
              ) : bottomTab === "processes" ? (
                <SshProcessList terminalId={terminalId} connected={connected} />
              ) : bottomTab === "docker" ? (
                <SshDockerPanel terminalId={terminalId} connected={connected} />
              ) : bottomTab === "network" ? (
                <SshNetworkPanel
                  terminalId={terminalId}
                  connected={connected}
                />
              ) : (
                <SshStoragePanel
                  terminalId={terminalId}
                  connected={connected}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

function TabButton({
  active,
  collapsed,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  collapsed: boolean;
  onClick: (e: React.MouseEvent) => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-1 px-3 py-1 text-xs transition-colors cursor-pointer ${
        active && !collapsed
          ? "text-[var(--accent-text)] border-b-2 border-[var(--accent)] -mb-px"
          : "text-zinc-500 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
      }`}
    >
      {icon}
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-0.5 inline-flex items-center justify-center min-w-[14px] h-3.5 px-0.5 rounded-full bg-blue-500 text-white text-[9px] font-bold leading-none">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
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
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <div className="w-16 h-1.5 bg-black/[0.10] dark:bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-500`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className="text-zinc-700 dark:text-zinc-300 tabular-nums w-9 text-right">
        {percent.toFixed(0)}%
      </span>
      {detail && (
        <span className="text-zinc-500 dark:text-zinc-500 text-[10px]">
          {detail}
        </span>
      )}
    </div>
  );
}

function sendResize(ws: WebSocket, cols: number, rows: number) {
  ws.send(`\x01${JSON.stringify({ cols, rows })}`);
}
