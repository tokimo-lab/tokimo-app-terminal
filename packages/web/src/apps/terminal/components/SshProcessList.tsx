/**
 * Remote process list panel for SSH terminal.
 * Lists processes via /api/apps/terminal/connections/{id}/ps endpoint.
 * Right-click context menu to kill processes.
 */
import { Input, ScrollArea, useContextMenu } from "@tokiomo/components";
import { CircleX, OctagonX, Pause, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/generated/rust-api";
import type { SshProcessEntry } from "@/generated/rust-types/SshProcessEntry";
import { formatBytes } from "./ssh-terminal-utils";

interface SshProcessListProps {
  terminalId: string;
  connected: boolean;
}

type SortKey = "pid" | "user" | "cpu" | "mem" | "rss" | "command";
type SortDir = "asc" | "desc";

const ROW_HEIGHT = 24;
const GRID_COLS = "grid-cols-[80px_100px_64px_64px_80px_minmax(0,1fr)]";

export default function SshProcessList({
  terminalId,
  connected,
}: SshProcessListProps) {
  const [processes, setProcesses] = useState<SshProcessEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("cpu");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [query, setQuery] = useState("");

  const { open: openCtxMenu, contextMenu } = useContextMenu();

  const fetchProcesses = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const resp = await api.sshTerminal.ps.fetch({ id: terminalId });
      setProcesses(resp.processes);
    } catch {
      setProcesses([]);
    } finally {
      setLoading(false);
    }
  }, [terminalId, connected]);

  useEffect(() => {
    if (!connected) return;
    fetchProcesses();
  }, [connected, fetchProcesses]);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir(
          key === "pid" || key === "user" || key === "command" ? "asc" : "desc",
        );
      }
    },
    [sortKey],
  );

  const handleKill = useCallback(
    async (pid: number, signal: string) => {
      try {
        await api.sshTerminal.kill.mutate({ id: terminalId, pid, signal });
        setTimeout(fetchProcesses, 500);
      } catch {
        // ignore
      }
    },
    [terminalId, fetchProcesses],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, proc: SshProcessEntry) => {
      openCtxMenu(e, [
        {
          key: "header",
          type: "group",
          label: `PID ${proc.pid}: ${proc.command.slice(0, 40)}`,
        },
        {
          key: "term",
          label: "终止 (SIGTERM)",
          icon: <CircleX size={13} />,
          onClick: () => handleKill(proc.pid, "TERM"),
        },
        {
          key: "kill",
          label: "强制终止 (SIGKILL)",
          icon: <OctagonX size={13} />,
          danger: true,
          onClick: () => handleKill(proc.pid, "KILL"),
        },
        {
          key: "stop",
          label: "挂起 (SIGSTOP)",
          icon: <Pause size={13} />,
          onClick: () => handleKill(proc.pid, "STOP"),
        },
        {
          key: "cont",
          label: "继续 (SIGCONT)",
          icon: <Play size={13} />,
          onClick: () => handleKill(proc.pid, "CONT"),
        },
      ]);
    },
    [openCtxMenu, handleKill],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? processes.filter(
          (p) =>
            p.command.toLowerCase().includes(q) ||
            p.user.toLowerCase().includes(q) ||
            String(p.pid).includes(q),
        )
      : processes;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "pid":
          return (a.pid - b.pid) * dir;
        case "user":
          return a.user.localeCompare(b.user) * dir;
        case "cpu":
          return (a.cpu - b.cpu) * dir;
        case "mem":
          return (a.mem - b.mem) * dir;
        case "rss":
          return (a.rssKb - b.rssKb) * dir;
        case "command":
          return a.command.localeCompare(b.command) * dir;
        default:
          return 0;
      }
    });
  }, [processes, query, sortKey, sortDir]);

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const renderRow = useCallback(
    (index: number) => {
      const proc = visible[index];
      if (!proc) return null;
      return (
        // biome-ignore lint/a11y/noStaticElementInteractions: context menu trigger only
        <div
          className={`grid ${GRID_COLS} items-center h-full text-fg-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.04] cursor-default`}
          onContextMenu={(e) => handleContextMenu(e, proc)}
        >
          <div className="px-2 text-fg-muted tabular-nums truncate">
            {proc.pid}
          </div>
          <div className="px-2 truncate">{proc.user}</div>
          <div
            className={`px-2 text-right tabular-nums ${proc.cpu > 50 ? "text-red-400" : proc.cpu > 10 ? "text-amber-400" : ""}`}
          >
            {proc.cpu.toFixed(1)}
          </div>
          <div
            className={`px-2 text-right tabular-nums ${proc.mem > 50 ? "text-red-400" : proc.mem > 10 ? "text-amber-400" : ""}`}
          >
            {proc.mem.toFixed(1)}
          </div>
          <div className="px-2 text-right tabular-nums text-fg-muted">
            {formatBytes(proc.rssKb * 1024)}
          </div>
          <div className="px-2 truncate">{proc.command}</div>
        </div>
      );
    },
    [visible, handleContextMenu],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-black/[0.08] dark:border-zinc-800/60 shrink-0">
        <span className="text-xs text-fg-muted whitespace-nowrap">
          {visible.length}
          {query ? ` / ${processes.length}` : ""} 个进程
        </span>
        <div className="flex-1 min-w-0">
          <Input
            size="small"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 PID / 用户 / 命令"
          />
        </div>
        <button
          type="button"
          onClick={fetchProcesses}
          className="p-0.5 text-fg-muted hover:text-fg-secondary transition-colors cursor-pointer"
          title="刷新进程列表"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Header */}
      <div
        className={`grid ${GRID_COLS} text-xs font-mono text-fg-secondary bg-surface-elevated border-b border-black/[0.08] dark:border-zinc-800/60 shrink-0`}
      >
        <HeaderCell onClick={() => handleSort("pid")}>
          PID{sortIndicator("pid")}
        </HeaderCell>
        <HeaderCell onClick={() => handleSort("user")}>
          USER{sortIndicator("user")}
        </HeaderCell>
        <HeaderCell onClick={() => handleSort("cpu")} align="right">
          CPU%{sortIndicator("cpu")}
        </HeaderCell>
        <HeaderCell onClick={() => handleSort("mem")} align="right">
          MEM%{sortIndicator("mem")}
        </HeaderCell>
        <HeaderCell onClick={() => handleSort("rss")} align="right">
          RSS{sortIndicator("rss")}
        </HeaderCell>
        <HeaderCell onClick={() => handleSort("command")}>
          COMMAND{sortIndicator("command")}
        </HeaderCell>
      </div>

      {/* Body */}
      {loading && processes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-fg-muted">
          加载中...
        </div>
      ) : visible.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-fg-muted">
          {processes.length === 0 ? "暂无进程" : "无匹配结果"}
        </div>
      ) : (
        <ScrollArea
          className="flex-1 min-h-0 text-xs font-mono"
          direction="vertical"
          itemCount={visible.length}
          itemHeight={ROW_HEIGHT}
          renderItem={renderRow}
          overscan={8}
        />
      )}

      {contextMenu}
    </div>
  );
}

function HeaderCell({
  children,
  onClick,
  align = "left",
}: {
  children: React.ReactNode;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 font-normal cursor-pointer text-fg-secondary hover:text-fg-primary transition-colors whitespace-nowrap select-none ${align === "right" ? "text-right" : "text-left"}`}
    >
      {children}
    </button>
  );
}
