/**
 * Remote storage/disk usage panel for SSH terminal.
 * Fetches disk info via /api/apps/terminal/connections/{id}/df endpoint.
 * Displays each mount point with a graphical usage bar.
 */
import { HardDrive } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/generated/rust-api";
import type { SshDiskEntry } from "@/generated/rust-types/SshDiskEntry";
import { type SshColumn, SshDataTable } from "./SshDataTable";
import { formatBytes } from "./ssh-terminal-utils";

interface SshStoragePanelProps {
  terminalId: string;
  connected: boolean;
}

export default function SshStoragePanel({
  terminalId,
  connected,
}: SshStoragePanelProps) {
  const [disks, setDisks] = useState<SshDiskEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDisks = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const resp = await api.sshTerminal.df.fetch({ id: terminalId });
      setDisks(resp.disks);
    } catch {
      setDisks([]);
    } finally {
      setLoading(false);
    }
  }, [terminalId, connected]);

  useEffect(() => {
    if (!connected) return;
    fetchDisks();
  }, [connected, fetchDisks]);

  const columns = useMemo<SshColumn<SshDiskEntry>[]>(
    () => [
      {
        key: "mount",
        header: "挂载点",
        width: "minmax(160px,1.2fr)",
        sortable: true,
        compare: (a, b) => a.mountPoint.localeCompare(b.mountPoint),
        render: (d) => (
          <div className="flex items-center gap-1.5 min-w-0">
            <HardDrive className="h-3 w-3 shrink-0 text-[var(--accent-text)]" />
            <span className="text-fg-primary truncate">{d.mountPoint}</span>
          </div>
        ),
      },
      {
        key: "filesystem",
        header: "文件系统",
        width: "minmax(120px,1fr)",
        sortable: true,
        compare: (a, b) => a.filesystem.localeCompare(b.filesystem),
        cellClassName: "px-2 truncate text-fg-muted",
        render: (d) => d.filesystem,
      },
      {
        key: "total",
        header: "总量",
        width: "90px",
        align: "right",
        sortable: true,
        compare: (a, b) => Number(a.totalBytes) - Number(b.totalBytes),
        render: (d) => formatBytes(d.totalBytes),
      },
      {
        key: "used",
        header: "已用",
        width: "90px",
        align: "right",
        sortable: true,
        compare: (a, b) => Number(a.usedBytes) - Number(b.usedBytes),
        render: (d) => formatBytes(d.usedBytes),
      },
      {
        key: "avail",
        header: "可用",
        width: "90px",
        align: "right",
        sortable: true,
        compare: (a, b) => Number(a.availableBytes) - Number(b.availableBytes),
        render: (d) => formatBytes(d.availableBytes),
      },
      {
        key: "usage",
        header: "使用率",
        width: "160px",
        sortable: true,
        compare: (a, b) => a.usagePercent - b.usagePercent,
        cellClassName: "px-2",
        render: (d) => <UsageBar percent={d.usagePercent} />,
      },
    ],
    [],
  );

  return (
    <SshDataTable
      items={disks}
      columns={columns}
      getRowKey={(d) => `${d.filesystem}-${d.mountPoint}`}
      loading={loading}
      onRefresh={fetchDisks}
      defaultSortKey="usage"
      defaultSortDir="desc"
      countLabel={(visible) => `${visible} 个磁盘分区`}
      emptyText="无磁盘信息"
    />
  );
}

function UsageBar({ percent }: { percent: number }) {
  const barColor =
    percent > 90
      ? "bg-red-500"
      : percent > 70
        ? "bg-amber-500"
        : "bg-[var(--accent)]";

  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 flex-1 bg-black/[0.10] dark:bg-zinc-700/60 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-500`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span
        className={`tabular-nums font-medium shrink-0 ${
          percent > 90
            ? "text-red-400"
            : percent > 70
              ? "text-amber-400"
              : "text-[var(--accent-text)]"
        }`}
      >
        {percent.toFixed(1)}%
      </span>
    </div>
  );
}
