/**
 * Remote storage/disk usage panel for SSH terminal.
 * Fetches disk info via /api/ssh-terminals/{id}/df endpoint.
 * Displays each mount point with a graphical usage bar.
 */
import { HardDrive, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../generated/rust-api";
import type { SshDiskEntry } from "../../generated/rust-types/SshDiskEntry";
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
      <div className="flex items-center justify-between px-3 py-1 border-b border-zinc-800/60 shrink-0">
        <span className="text-xs text-zinc-400">{disks.length} 个磁盘分区</span>
        <button
          type="button"
          onClick={fetchDisks}
          className="p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
          title="刷新存储信息"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Disk list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {loading && disks.length === 0 ? (
          <div className="text-zinc-600 text-xs px-1 py-1">加载中...</div>
        ) : disks.length === 0 ? (
          <div className="text-zinc-600 text-xs px-1 py-1">无磁盘信息</div>
        ) : (
          disks.map((disk) => (
            <DiskCard
              key={`${disk.filesystem}-${disk.mountPoint}`}
              disk={disk}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DiskCard({ disk }: { disk: SshDiskEntry }) {
  const barColor =
    disk.usagePercent > 90
      ? "bg-red-500"
      : disk.usagePercent > 70
        ? "bg-amber-500"
        : "bg-[var(--accent)]";

  return (
    <div className="rounded-lg bg-zinc-800/50 p-2.5 space-y-1.5">
      {/* Row 1: icon + mount + filesystem */}
      <div className="flex items-center gap-2">
        <HardDrive className="h-3.5 w-3.5 shrink-0 text-[var(--accent-text)]" />
        <span className="text-xs text-zinc-200 font-medium truncate">
          {disk.mountPoint}
        </span>
        <span className="text-[10px] text-zinc-600 ml-auto shrink-0">
          {disk.filesystem}
        </span>
      </div>

      {/* Row 2: progress bar */}
      <div className="h-2 bg-zinc-700/60 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-500`}
          style={{ width: `${Math.min(disk.usagePercent, 100)}%` }}
        />
      </div>

      {/* Row 3: stats */}
      <div className="flex items-center justify-between text-[10px] text-zinc-500">
        <span>
          已用{" "}
          <span className="text-zinc-300">{formatBytes(disk.usedBytes)}</span>
          {" / "}
          {formatBytes(disk.totalBytes)}
        </span>
        <span>
          可用{" "}
          <span className="text-zinc-400">
            {formatBytes(disk.availableBytes)}
          </span>
        </span>
        <span
          className={`font-medium tabular-nums ${
            disk.usagePercent > 90
              ? "text-red-400"
              : disk.usagePercent > 70
                ? "text-amber-400"
                : "text-[var(--accent-text)]"
          }`}
        >
          {disk.usagePercent.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
