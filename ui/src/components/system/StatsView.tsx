import { Spin } from "@tokimo/ui";
import { Cpu, MemoryStick } from "lucide-react";
import { useCallback } from "react";
import { terminalApi } from "../../api/client";
import type { SshHostStats } from "../../api/types";
import { useAsync } from "../../hooks/useAsync";
import { formatBytes, formatPercent } from "../../lib/format";

interface StatsViewProps {
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
    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
      <div
        className={`h-full rounded-full transition-all duration-500 ${barColor(percent)}`}
        style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  primary,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  primary: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-900/60 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
        {primary}
      </div>
      {children}
    </div>
  );
}

function MemoryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs text-zinc-400">
      <span>{label}</span>
      <span className="tabular-nums text-zinc-200">{value}</span>
    </div>
  );
}

export function StatsView({ terminalId, refreshToken }: StatsViewProps) {
  const loader = useCallback(() => terminalApi.stats(terminalId), [terminalId]);
  const { data, loading, error } = useAsync<SshHostStats>(loader, [
    loader,
    refreshToken,
  ]);

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
  if (!data) return null;

  const swapPercent =
    data.swapTotalBytes > 0
      ? (data.swapUsedBytes / data.swapTotalBytes) * 100
      : 0;

  return (
    <div className="grid grid-cols-1 gap-4 overflow-auto p-4 md:grid-cols-2">
      <StatCard
        icon={<Cpu className="h-3.5 w-3.5" />}
        label="CPU Usage"
        primary={formatPercent(data.cpuUsagePercent)}
      >
        <div className="mt-3">
          <UsageBar percent={data.cpuUsagePercent} />
        </div>
      </StatCard>

      <StatCard
        icon={<MemoryStick className="h-3.5 w-3.5" />}
        label="Memory"
        primary={`${formatBytes(data.memUsedBytes)} / ${formatBytes(data.memTotalBytes)}`}
      >
        <div className="mt-3 space-y-2">
          <UsageBar percent={data.memUsagePercent} />
          <div className="flex justify-end text-xs text-zinc-400">
            {formatPercent(data.memUsagePercent)} used
          </div>
          <MemoryRow
            label="Available"
            value={formatBytes(data.memAvailableBytes)}
          />
          <MemoryRow
            label="Buffers"
            value={formatBytes(data.memBuffersBytes)}
          />
          <MemoryRow label="Cached" value={formatBytes(data.memCachedBytes)} />
        </div>
      </StatCard>

      <StatCard
        icon={<MemoryStick className="h-3.5 w-3.5" />}
        label="Swap"
        primary={`${formatBytes(data.swapUsedBytes)} / ${formatBytes(data.swapTotalBytes)}`}
      >
        <div className="mt-3 space-y-2">
          <UsageBar percent={swapPercent} />
          <div className="flex justify-end text-xs text-zinc-400">
            {formatPercent(swapPercent)} used
          </div>
        </div>
      </StatCard>
    </div>
  );
}
