import { Table, type TableColumn } from "@tokimo/ui";
import { useCallback, useMemo } from "react";
import { terminalApi } from "../../api/client";
import type { DockerStatsEntry } from "../../api/types";
import { useAsync } from "../../hooks/useAsync";

interface StatsTableProps {
  terminalId: string;
  refreshKey: number;
}

function pctClass(value: string): string {
  const n = Number.parseFloat(value);
  if (n > 80) return "text-red-400";
  if (n > 50) return "text-amber-400";
  return "text-green-400";
}

export function StatsTable({ terminalId, refreshKey }: StatsTableProps) {
  const loader = useCallback(
    () => terminalApi.dockerStats(terminalId),
    [terminalId],
  );
  const state = useAsync(loader, [loader, refreshKey]);

  const columns = useMemo<TableColumn<DockerStatsEntry>[]>(
    () => [
      {
        title: "Name",
        key: "name",
        render: (_v, s) => (
          <span className="truncate text-zinc-200">{s.name}</span>
        ),
      },
      {
        title: "CPU %",
        key: "cpu",
        width: 80,
        align: "right",
        render: (_v, s) => (
          <span className={`tabular-nums ${pctClass(s.cpuPercent)}`}>
            {s.cpuPercent}
          </span>
        ),
      },
      {
        title: "MEM Usage / Limit",
        key: "mem",
        render: (_v, s) => (
          <span className="tabular-nums text-zinc-400">
            {s.memUsage} / {s.memLimit}
          </span>
        ),
      },
      {
        title: "MEM %",
        key: "memPct",
        width: 80,
        align: "right",
        render: (_v, s) => (
          <span className={`tabular-nums ${pctClass(s.memPercent)}`}>
            {s.memPercent}
          </span>
        ),
      },
      {
        title: "NET I/O",
        key: "netIo",
        align: "right",
        render: (_v, s) => (
          <span className="tabular-nums text-zinc-400">{s.netIo}</span>
        ),
      },
      {
        title: "Block I/O",
        key: "blockIo",
        align: "right",
        render: (_v, s) => (
          <span className="tabular-nums text-zinc-400">{s.blockIo}</span>
        ),
      },
      {
        title: "PIDs",
        key: "pids",
        width: 72,
        align: "right",
        render: (_v, s) => (
          <span className="tabular-nums text-zinc-400">{s.pids}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex h-full flex-col">
      {state.error ? (
        <div className="m-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {state.error}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table<DockerStatsEntry>
          columns={columns}
          dataSource={state.data?.stats ?? []}
          rowKey="containerId"
          size="small"
          pagination={false}
          loading={state.loading}
        />
      </div>
    </div>
  );
}
