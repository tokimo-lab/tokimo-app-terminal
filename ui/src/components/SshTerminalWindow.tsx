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
import { CopyPlus } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppearance, useWindowActions, useWindows } from "@tokimo/sdk";
import { type TerminalThemeId } from "@tokimo/terminal";
import { terminalApi } from "../api/client";
import type { SshHostStats } from "../api/types";
import { useComponentPreference } from "../hooks/use-preference";
import { formatBytes } from "./ssh-terminal-utils";
import { StatGauge } from "./SshTerminalPanelBits";
import { useUploadQueue } from "./SshTerminalUploadQueue";
import { useTerminalSession } from "./SshTerminalSession";
import SshTerminalBottomPanel from "./SshTerminalBottomPanel";

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

type BottomTab = "files" | "processes" | "storage" | "network" | "docker";

interface TerminalPrefData {
  theme?: { colorScheme?: string };
  panelHeights?: Record<string, number>;
  panelCollapsedMap?: Record<string, boolean>;
}

export default function SshTerminalWindow({
  terminalId,
  initialSessionId,
  connectionLabel: connectionLabelProp,
}: SshTerminalWindowProps) {
  const windows = useWindows();
  const { openWindow, currentWindowId } = useWindowActions();
  const { theme } = useAppearance();
  const terminalPref = useComponentPreference<TerminalPrefData>("terminal");
  const terminalColorScheme = (terminalPref.data.theme?.colorScheme ??
    "auto") as TerminalThemeId;

  // Panel height / collapsed state is persisted to the app's DB-backed
  // preferences, keyed by terminalId so multiple terminals hosted inside the
  // same page window don't clobber each other. (The host's minimal window DTO
  // does not expose metadata, so per-window metadata persistence is not used.)
  const prefDataRef = useRef(terminalPref.data);
  prefDataRef.current = terminalPref.data;
  const savedPanelHeight = terminalPref.data.panelHeights?.[terminalId] || 192;
  const savedPanelCollapsed =
    terminalPref.data.panelCollapsedMap?.[terminalId] ?? false;

  // ── Session ID: stable UUID for this terminal's PTY session. ──
  // Provided by the parent (TerminalAppPage) so it stays stable while mounted.
  const sessionIdRef = useRef<string>(
    initialSessionId || crypto.randomUUID(),
  );

  // ── Initial CWD: send a `cd` command once after first connect (used by the
  // duplicate flow). Not persisted across reloads. ──
  const initialCwdRef = useRef<string | null>(null);
  // Track the file-browser's current directory so Duplicate can carry it over.
  const fileBrowserPathRef = useRef<string>("/");
  const handleFileBrowserPathChange = useCallback((p: string) => {
    fileBrowserPathRef.current = p;
  }, []);

  const [bottomTab, setBottomTab] = useState<BottomTab>("files");
  const [panelCollapsed, setPanelCollapsed] = useState(savedPanelCollapsed);

  // ── Terminal session (xterm + WebSocket) ──
  const { containerRef, fitAddonRef, status, handleReconnect } =
    useTerminalSession({
      terminalId,
      sessionIdRef,
      initialCwdRef,
      terminalColorScheme,
      appTheme: theme,
    });

  // ── Upload queue ──
  const { uploadQueue, handleUploadFiles, activeUploadCount } =
    useUploadQueue(terminalId);

  // Keep latest persisted maps accessible inside callbacks (avoids stale
  // closures clobbering concurrent keys in the per-terminal map).
  const persistPanelHeight = useCallback(
    (h: number) => {
      const cur = prefDataRef.current.panelHeights ?? {};
      void terminalPref.patch({ panelHeights: { ...cur, [terminalId]: h } });
    },
    [terminalId, terminalPref],
  );

  const persistPanelCollapsed = useCallback(
    (c: boolean) => {
      const cur = prefDataRef.current.panelCollapsedMap ?? {};
      void terminalPref.patch({
        panelCollapsedMap: { ...cur, [terminalId]: c },
      });
    },
    [terminalId, terminalPref],
  );

  // ── Resizable bottom panel ──
  const [panelHeight, setPanelHeight] = useState(savedPanelHeight);
  const panelHeightRef = useRef(panelHeight);
  const draggingRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleToggleCollapse = useCallback(() => {
    const newCollapsed = !panelCollapsed;
    setPanelCollapsed(newCollapsed);
    persistPanelCollapsed(newCollapsed);
    requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // ignore
      }
    });
  }, [panelCollapsed, persistPanelCollapsed]);

  const handleTabButtonClick = useCallback(
    (tab: BottomTab) => {
      setBottomTab(tab);
      if (panelCollapsed) {
        setPanelCollapsed(false);
        persistPanelCollapsed(false);
        requestAnimationFrame(() => {
          try {
            fitAddonRef.current?.fit();
          } catch {
            // ignore
          }
        });
      }
    },
    [panelCollapsed, persistPanelCollapsed],
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
        // Persist panel height to window metadata (per terminalId)
        persistPanelHeight(panelHeightRef.current);
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
    [panelHeight, persistPanelHeight],
  );

  // ── Host stats polling ──
  const [hostStats, setHostStats] = useState<SshHostStats | null>(null);
  const windowActive =
    windows.find((w) => w.id === currentWindowId)?.active ?? true;

  useEffect(() => {
    if (status !== "connected" || !windowActive) return;
    let cancelled = false;

    const fetchStats = async () => {
      try {
        const resp = await terminalApi.stats(terminalId);
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
      title: connectionLabelProp || terminalId,
      route: `/terminals/${terminalId}`,
      sourceType: "ssh_terminal",
      sourceId: terminalId,
      metadata: {
        sshTerminalId: terminalId,
        sshSessionId: crypto.randomUUID(),
        sshInitialCwd: fileBrowserPathRef.current,
      },
    });
  }, [openWindow, terminalId, connectionLabelProp]);

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
            <span className="text-fg-muted">{statusText}</span>
          </div>

          {hostStats && connected && (
            <>
              <span className="text-fg-muted">|</span>
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
                <span className="text-fg-muted text-[10px]">
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
            className="flex items-center justify-center h-5 w-5 rounded text-fg-muted hover:text-fg-primary hover:bg-black/[0.08]/60 transition-colors"
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

      {/* ── Bottom panel ── */}
      <SshTerminalBottomPanel
        terminalId={terminalId}
        connected={connected}
        panelCollapsed={panelCollapsed}
        panelHeight={panelHeight}
        bottomTab={bottomTab}
        uploadQueue={uploadQueue}
        activeUploadCount={activeUploadCount}
        connectionLabel={connectionLabelProp}
        onToggleCollapse={handleToggleCollapse}
        onTabButtonClick={handleTabButtonClick}
        onUploadFiles={handleUploadFiles}
        onFileBrowserPathChange={handleFileBrowserPathChange}
        onDragStart={handleDragStart}
      />
    </div>
  );
}
