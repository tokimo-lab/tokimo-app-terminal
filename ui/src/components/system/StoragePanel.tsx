import { Empty, Spin, Table, type TableColumn } from "@tokimo/ui";
import { useCallback } from "react";
import { terminalApi } from "../../api/client";
import type { SshDfResponse, SshDiskEntry } from "../../api/types";
import { useAsync } from "../../hooks/useAsync";
import { formatBytes, formatPercent } from "../../lib/format";

interface StoragePanelProps {
  terminalId: string;
  refreshToken: number;
}

function barColor(percent: number): string {
  if (percent > 90) return "bg-red-500";
  if (percent > 70) return "bg-amber-500";
  return "bg-violet-500";
}

function UsageBar({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor(percent)}`}
          style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
        />
      </div>
      <span className="shrink-0 tabular-nums text-zinc-300">
        {formatPercent(percent)}
      </span>
    </div>
  );
}

export function StoragePanel({ terminalId, refreshToken }: StoragePanelProps) {
  const loader = useCallback(() => terminalApi.df(terminalId), [terminalId]);
  const { data, loading, error } = useAsync<SshDfResponse>(loader, [
    loader,
    refreshToken,
  ]);

  const columns: TableColumn<SshDiskEntry>[] = [
    {
      title: "Filesystem",
      key: "filesystem",
      render: (_value: unknown, d: SshDiskEntry) => (
        <span className="font-mono text-zinc-200">{d.filesystem}</span>
      ),
    },
    {
      title: "Mount",
      key: "mountPoint",
      render: (_value: unknown, d: SshDiskEntry) => (
        <span className="font-mono text-zinc-200">{d.mountPoint}</span>
      ),
    },
    {
      title: "Size",
      key: "total",
      width: 100,
      align: "right",
      sorter: (a, b) => a.totalBytes - b.totalBytes,
      render: (_value: unknown, d: SshDiskEntry) => formatBytes(d.totalBytes),
    },
    {
      title: "Used",
      key: "used",
      width: 100,
      align: "right",
      sorter: (a, b) => a.usedBytes - b.usedBytes,
      render: (_value: unknown, d: SshDiskEntry) => formatBytes(d.usedBytes),
    },
    {
      title: "Avail",
      key: "avail",
      width: 100,
      align: "right",
      sorter: (a, b) => a.availableBytes - b.availableBytes,
      render: (_value: unknown, d: SshDiskEntry) =>
        formatBytes(d.availableBytes),
    },
    {
      title: "Use%",
      key: "usage",
      width: 180,
      sorter: (a, b) => a.usagePercent - b.usagePercent,
      render: (_value: unknown, d: SshDiskEntry) => (
        <UsageBar percent={d.usagePercent} />
      ),
    },
  ];

  if (error) {
    return (
      <div className="m-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
        {error}
      </div>
    );
  }
  if (loading && !data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Spin />
      </div>
    );
  }

  const disks = data?.disks ?? [];
  if (disks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty description="No disks" />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      <Table<SshDiskEntry>
        columns={columns}
        dataSource={disks}
        rowKey={(d) => `${d.filesystem}-${d.mountPoint}`}
        size="small"
        pagination={false}
        loading={loading}
      />
    </div>
  );
}
