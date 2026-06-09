/**
 * Remote process list panel for SSH terminal.
 * Lists processes via /api/apps/terminal/connections/{id}/ps endpoint.
 * Right-click context menu to kill processes.
 */
import { useContextMenu } from "@tokimo/ui";
import { CircleX, OctagonX, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { terminalApi } from "../api/client";
import type { SshProcessEntry } from "../api/types";
import { type SshColumn, SshDataTable } from "./SshDataTable";
import { formatBytes } from "./ssh-terminal-utils";

interface SshProcessListProps {
  terminalId: string;
  connected: boolean;
}

export default function SshProcessList({
  terminalId,
  connected,
}: SshProcessListProps) {
  const [processes, setProcesses] = useState<SshProcessEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const { open: openCtxMenu, contextMenu } = useContextMenu();

  const fetchProcesses = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const resp = await terminalApi.ps(terminalId);
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

  const handleKill = useCallback(
    async (pid: number, signal: string) => {
      try {
        await terminalApi.kill(terminalId, pid, signal);
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

  const columns = useMemo<SshColumn<SshProcessEntry>[]>(
    () => [
      {
        key: "pid",
        header: "PID",
        width: "80px",
        align: "right",
        sortable: true,
        compare: (a, b) => a.pid - b.pid,
        cellClassName: "px-2 text-right tabular-nums text-fg-muted truncate",
        render: (p) => p.pid,
      },
      {
        key: "user",
        header: "USER",
        width: "100px",
        sortable: true,
        compare: (a, b) => a.user.localeCompare(b.user),
        render: (p) => p.user,
      },
      {
        key: "cpu",
        header: "CPU%",
        width: "64px",
        align: "right",
        sortable: true,
        compare: (a, b) => a.cpu - b.cpu,
        cellClassName:
          "px-2 text-right tabular-nums [--mark-red:text-red-400] [--mark-amber:text-amber-400]",
        render: (p) => (
          <span
            className={
              p.cpu > 50
                ? "text-red-400"
                : p.cpu > 10
                  ? "text-amber-400"
                  : undefined
            }
          >
            {p.cpu.toFixed(1)}
          </span>
        ),
      },
      {
        key: "mem",
        header: "MEM%",
        width: "64px",
        align: "right",
        sortable: true,
        compare: (a, b) => a.mem - b.mem,
        render: (p) => (
          <span
            className={
              p.mem > 50
                ? "text-red-400"
                : p.mem > 10
                  ? "text-amber-400"
                  : undefined
            }
          >
            {p.mem.toFixed(1)}
          </span>
        ),
      },
      {
        key: "rss",
        header: "RSS",
        width: "80px",
        align: "right",
        sortable: true,
        compare: (a, b) => a.rssKb - b.rssKb,
        cellClassName: "px-2 text-right tabular-nums text-fg-muted",
        render: (p) => formatBytes(p.rssKb * 1024),
      },
      {
        key: "command",
        header: "COMMAND",
        width: "minmax(0,1fr)",
        sortable: true,
        compare: (a, b) => a.command.localeCompare(b.command),
        render: (p) => p.command,
      },
    ],
    [],
  );

  return (
    <>
      <SshDataTable
        items={processes}
        columns={columns}
        getRowKey={(p) => p.pid}
        loading={loading}
        onRefresh={fetchProcesses}
        searchable
        searchPlaceholder="搜索 PID / 用户 / 命令"
        filterFn={(p, q) =>
          p.command.toLowerCase().includes(q) ||
          p.user.toLowerCase().includes(q) ||
          String(p.pid).includes(q)
        }
        defaultSortKey="cpu"
        defaultSortDir="desc"
        countLabel={(visible, total, filtered) =>
          `${visible}${filtered ? ` / ${total}` : ""} 个进程`
        }
        emptyText="暂无进程"
        onRowContextMenu={handleContextMenu}
      />
      {contextMenu}
    </>
  );
}
