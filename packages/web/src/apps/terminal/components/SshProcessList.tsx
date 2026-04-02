/**
 * Remote process list panel for SSH terminal.
 * Lists processes via /api/apps/terminal/connections/{id}/ps endpoint.
 * Right-click context menu to kill processes.
 */
import { useContextMenu } from "@tokiomo/components";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/generated/rust-api";
import type { SshProcessEntry } from "@/generated/rust-types/SshProcessEntry";
import { formatBytes } from "./ssh-terminal-utils";

interface SshProcessListProps {
  terminalId: string;
  connected: boolean;
}

type SortKey = "pid" | "user" | "cpu" | "mem" | "rss" | "command";
type SortDir = "asc" | "desc";

export default function SshProcessList({
  terminalId,
  connected,
}: SshProcessListProps) {
  const [processes, setProcesses] = useState<SshProcessEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("cpu");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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
          onClick: () => handleKill(proc.pid, "TERM"),
        },
        {
          key: "kill",
          label: "强制终止 (SIGKILL)",
          danger: true,
          onClick: () => handleKill(proc.pid, "KILL"),
        },
        {
          key: "stop",
          label: "挂起 (SIGSTOP)",
          onClick: () => handleKill(proc.pid, "STOP"),
        },
        {
          key: "cont",
          label: "继续 (SIGCONT)",
          onClick: () => handleKill(proc.pid, "CONT"),
        },
      ]);
    },
    [openCtxMenu, handleKill],
  );

  const sorted = [...processes].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
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

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-black/[0.08] dark:border-zinc-800/60 shrink-0">
        <span className="text-xs text-fg-muted">{processes.length} 个进程</span>
        <button
          type="button"
          onClick={fetchProcesses}
          className="p-0.5 text-fg-muted hover:text-zinc-800 dark:hover:text-zinc-300 transition-colors"
          title="刷新进程列表"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto overflow-x-auto text-xs font-mono">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-surface-elevated z-10">
            <tr className="text-fg-secondary">
              <SortTh onClick={() => handleSort("pid")}>
                PID{sortIndicator("pid")}
              </SortTh>
              <SortTh onClick={() => handleSort("user")}>
                USER{sortIndicator("user")}
              </SortTh>
              <SortTh onClick={() => handleSort("cpu")} align="right">
                CPU%{sortIndicator("cpu")}
              </SortTh>
              <SortTh onClick={() => handleSort("mem")} align="right">
                MEM%{sortIndicator("mem")}
              </SortTh>
              <SortTh onClick={() => handleSort("rss")} align="right">
                RSS{sortIndicator("rss")}
              </SortTh>
              <SortTh onClick={() => handleSort("command")}>
                COMMAND{sortIndicator("command")}
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {loading && processes.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-fg-muted px-2 py-2 text-center">
                  加载中...
                </td>
              </tr>
            ) : (
              sorted.map((proc) => (
                <tr
                  key={proc.pid}
                  className="text-fg-secondary hover:bg-black/[0.04] dark:hover:bg-zinc-800/50 cursor-default"
                  onContextMenu={(e) => handleContextMenu(e, proc)}
                >
                  <td className="px-2 py-0.5 text-fg-muted">{proc.pid}</td>
                  <td className="px-2 py-0.5 max-w-20 truncate">{proc.user}</td>
                  <td
                    className={`px-2 py-0.5 text-right tabular-nums ${proc.cpu > 50 ? "text-red-400" : proc.cpu > 10 ? "text-amber-400" : ""}`}
                  >
                    {proc.cpu.toFixed(1)}
                  </td>
                  <td
                    className={`px-2 py-0.5 text-right tabular-nums ${proc.mem > 50 ? "text-red-400" : proc.mem > 10 ? "text-amber-400" : ""}`}
                  >
                    {proc.mem.toFixed(1)}
                  </td>
                  <td className="px-2 py-0.5 text-right tabular-nums text-fg-muted dark:text-zinc-300">
                    {formatBytes(proc.rssKb * 1024)}
                  </td>
                  <td className="px-2 py-0.5 max-w-60 truncate">
                    {proc.command}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {contextMenu}
    </div>
  );
}

function SortTh({
  children,
  onClick,
  align = "left",
}: {
  children: React.ReactNode;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-2 py-1 font-normal cursor-pointer text-fg-secondary hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors whitespace-nowrap select-none ${align === "right" ? "text-right" : "text-left"}`}
      onClick={onClick}
    >
      {children}
    </th>
  );
}
