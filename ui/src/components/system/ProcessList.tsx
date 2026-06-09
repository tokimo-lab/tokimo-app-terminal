import {
  Button,
  Empty,
  Modal,
  Spin,
  Table,
  type TableColumn,
  useToast,
} from "@tokimo/ui";
import { useCallback } from "react";
import { terminalApi } from "../../api/client";
import type { SshProcessEntry, SshPsResponse } from "../../api/types";
import { useAsync } from "../../hooks/useAsync";
import { formatBytes } from "../../lib/format";

interface ProcessListProps {
  terminalId: string;
  refreshToken: number;
}

function usageClass(percent: number): string | undefined {
  if (percent > 50) return "text-red-400";
  if (percent > 10) return "text-amber-400";
  return undefined;
}

export function ProcessList({ terminalId, refreshToken }: ProcessListProps) {
  const toast = useToast();
  const loader = useCallback(() => terminalApi.ps(terminalId), [terminalId]);
  const { data, loading, error, reload } = useAsync<SshPsResponse>(loader, [
    loader,
    refreshToken,
  ]);

  const handleKill = useCallback(
    (proc: SshProcessEntry) => {
      Modal.confirm({
        title: `Kill process ${proc.pid}?`,
        content: proc.command,
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await terminalApi.kill(terminalId, proc.pid);
            toast.success(`Sent kill signal to ${proc.pid}`);
            reload();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
          }
        },
      });
    },
    [terminalId, toast, reload],
  );

  const columns: TableColumn<SshProcessEntry>[] = [
    { title: "PID", dataIndex: "pid", key: "pid", width: 80, align: "right" },
    { title: "USER", dataIndex: "user", key: "user", width: 110 },
    {
      title: "CPU%",
      key: "cpu",
      width: 80,
      align: "right",
      sorter: (a, b) => a.cpu - b.cpu,
      render: (_value: unknown, p: SshProcessEntry) => (
        <span className={`tabular-nums ${usageClass(p.cpu) ?? ""}`}>
          {p.cpu.toFixed(1)}
        </span>
      ),
    },
    {
      title: "MEM%",
      key: "mem",
      width: 80,
      align: "right",
      sorter: (a, b) => a.mem - b.mem,
      render: (_value: unknown, p: SshProcessEntry) => (
        <span className={`tabular-nums ${usageClass(p.mem) ?? ""}`}>
          {p.mem.toFixed(1)}
        </span>
      ),
    },
    {
      title: "RSS",
      key: "rss",
      width: 90,
      align: "right",
      sorter: (a, b) => a.rssKb - b.rssKb,
      render: (_value: unknown, p: SshProcessEntry) => (
        <span className="tabular-nums text-zinc-400">
          {formatBytes(p.rssKb * 1024)}
        </span>
      ),
    },
    { title: "STAT", dataIndex: "stat", key: "stat", width: 80 },
    {
      title: "COMMAND",
      key: "command",
      render: (_value: unknown, p: SshProcessEntry) => (
        <span className="font-mono text-zinc-200">{p.command}</span>
      ),
    },
    {
      title: "",
      key: "actions",
      width: 80,
      align: "right",
      render: (_value: unknown, p: SshProcessEntry) => (
        <Button size="small" variant="danger" onClick={() => handleKill(p)}>
          Kill
        </Button>
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

  const processes = data?.processes ?? [];
  if (processes.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty description="No processes" />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      <Table<SshProcessEntry>
        columns={columns}
        dataSource={processes}
        rowKey={(p) => String(p.pid)}
        size="small"
        pagination={false}
        loading={loading}
      />
    </div>
  );
}
