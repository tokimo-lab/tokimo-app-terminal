/**
 * Remote storage/disk usage panel for SSH terminal.
 * Fetches disk info via /api/apps/terminal/connections/{id}/df endpoint.
 * Displays each mount point with a graphical usage bar.
 */
import { LoadingOutlined } from "@tokiomo/components";
import { HardDrive, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/generated/rust-api";
import type { SshDiskEntry } from "@/generated/rust-types/SshDiskEntry";
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-black/[0.08] dark:border-zinc-800/60 shrink-0">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {disks.length} 个磁盘分区
        </span>
        <button
          type="button"
          onClick={fetchDisks}
          className="p-0.5 text-zinc-500 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 transition-colors"
          title="刷新存储信息"
        >
          {loading ? (
            <LoadingOutlined className="h-3 w-3" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Disk table */}
      <div className="flex-1 overflow-y-auto">
        {loading && disks.length === 0 ? (
          <div className="text-zinc-500 dark:text-zinc-500 text-xs px-3 py-2">
            加载中...
          </div>
        ) : disks.length === 0 ? (
          <div className="text-zinc-500 dark:text-zinc-500 text-xs px-3 py-2">
            无磁盘信息
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-zinc-600 dark:text-zinc-400 border-b border-black/[0.08] dark:border-zinc-800/60">
                <th className="text-left font-normal px-3 py-1">挂载点</th>
                <th className="text-left font-normal px-2 py-1">文件系统</th>
                <th className="text-right font-normal px-2 py-1">总量</th>
                <th className="text-right font-normal px-2 py-1">已用</th>
                <th className="text-right font-normal px-2 py-1">可用</th>
                <th className="text-right font-normal px-2 py-1 w-20">
                  使用率
                </th>
              </tr>
            </thead>
            <tbody>
              {disks.map((disk) => (
                <DiskRow
                  key={`${disk.filesystem}-${disk.mountPoint}`}
                  disk={disk}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
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

function DiskRow({ disk }: { disk: SshDiskEntry }) {
  return (
    <tr className="border-b border-black/[0.05] dark:border-zinc-800/30 hover:bg-black/[0.04] dark:hover:bg-zinc-800/30 transition-colors">
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <HardDrive className="h-3 w-3 shrink-0 text-[var(--accent-text)]" />
          <span className="text-zinc-800 dark:text-zinc-200 truncate max-w-32">
            {disk.mountPoint}
          </span>
        </div>
      </td>
      <td className="px-2 py-1.5 text-zinc-500 dark:text-zinc-400 truncate max-w-24">
        {disk.filesystem}
      </td>
      <td className="px-2 py-1.5 text-right text-zinc-700 dark:text-zinc-300 tabular-nums">
        {formatBytes(disk.totalBytes)}
      </td>
      <td className="px-2 py-1.5 text-right text-zinc-700 dark:text-zinc-300 tabular-nums">
        {formatBytes(disk.usedBytes)}
      </td>
      <td className="px-2 py-1.5 text-right text-zinc-700 dark:text-zinc-300 tabular-nums">
        {formatBytes(disk.availableBytes)}
      </td>
      <td className="px-2 py-1.5 w-20">
        <UsageBar percent={disk.usagePercent} />
      </td>
    </tr>
  );
}
