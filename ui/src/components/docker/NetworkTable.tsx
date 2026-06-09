import {
  Button,
  type ContextMenuItem,
  Modal,
  Table,
  type TableColumn,
  useContextMenu,
  useToast,
} from "@tokimo/ui";
import { Eraser, Trash2 } from "lucide-react";
import { useCallback, useMemo } from "react";
import { terminalApi } from "../../api/client";
import type { DockerNetworkEntry } from "../../api/types";
import { useAsync } from "../../hooks/useAsync";

interface NetworkTableProps {
  terminalId: string;
  refreshKey: number;
}

const PROTECTED_NETWORKS = new Set(["bridge", "host", "none"]);

export function NetworkTable({ terminalId, refreshKey }: NetworkTableProps) {
  const toast = useToast();
  const { open: openCtxMenu, contextMenu } = useContextMenu();

  const loader = useCallback(
    () => terminalApi.dockerNetworks(terminalId),
    [terminalId],
  );
  const state = useAsync(loader, [loader, refreshKey]);

  const remove = useCallback(
    async (networkId: string) => {
      try {
        await terminalApi.dockerNetworkRm(terminalId, networkId);
        toast.success("Network removed");
        state.reload();
      } catch (err: unknown) {
        toast.error(
          err instanceof Error ? err.message : "Failed to remove network",
        );
      }
    },
    [terminalId, toast, state],
  );

  const confirmRemove = useCallback(
    (n: DockerNetworkEntry) => {
      Modal.confirm({
        title: "Remove network",
        content: `Remove network "${n.name}"?`,
        variant: "danger",
        okText: "Remove",
        okButtonProps: { danger: true },
        onOk: () => remove(n.id),
      });
    },
    [remove],
  );

  const prune = useCallback(() => {
    Modal.confirm({
      title: "Prune networks",
      content: "Remove all unused networks?",
      variant: "danger",
      okText: "Prune",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const resp = await terminalApi.dockerPruneNetworks(terminalId);
          toast.success(resp.output.trim() || "Networks pruned");
          state.reload();
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Prune failed");
        }
      },
    });
  }, [terminalId, toast, state]);

  const columns = useMemo<TableColumn<DockerNetworkEntry>[]>(
    () => [
      {
        title: "Name",
        key: "name",
        render: (_v, n) => (
          <span className="truncate text-zinc-200">{n.name}</span>
        ),
      },
      {
        title: "Driver",
        key: "driver",
        width: 110,
        render: (_v, n) => <span className="text-zinc-400">{n.driver}</span>,
      },
      {
        title: "Scope",
        key: "scope",
        width: 96,
        render: (_v, n) => <span className="text-zinc-400">{n.scope}</span>,
      },
      {
        title: "Subnet",
        key: "subnet",
        render: (_v, n) => (
          <span className="truncate font-mono text-zinc-400">
            {n.ipamSubnet || "-"}
          </span>
        ),
      },
      {
        title: "Gateway",
        key: "gateway",
        render: (_v, n) => (
          <span className="truncate font-mono text-zinc-400">
            {n.ipamGateway || "-"}
          </span>
        ),
      },
      {
        title: "Actions",
        key: "actions",
        width: 64,
        align: "right",
        render: (_v, n) =>
          PROTECTED_NETWORKS.has(n.name) ? null : (
            <button
              type="button"
              title="Remove"
              onClick={(e) => {
                e.stopPropagation();
                confirmRemove(n);
              }}
              className="cursor-pointer rounded p-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-red-400"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          ),
      },
    ],
    [confirmRemove],
  );

  const buildMenu = useCallback(
    (n: DockerNetworkEntry): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [
        { key: "header", type: "group", label: n.name },
      ];
      if (!PROTECTED_NETWORKS.has(n.name)) {
        items.push({
          key: "rm",
          label: "Remove",
          icon: <Trash2 size={13} />,
          danger: true,
          onClick: () => confirmRemove(n),
        });
      }
      return items;
    },
    [confirmRemove],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end border-b border-white/10 px-2 py-1.5">
        <Button
          size="xs"
          variant="text"
          icon={<Eraser className="h-3 w-3" />}
          onClick={prune}
        >
          Prune networks
        </Button>
      </div>
      {state.error ? (
        <div className="m-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {state.error}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table<DockerNetworkEntry>
          columns={columns}
          dataSource={state.data?.networks ?? []}
          rowKey="id"
          size="small"
          pagination={false}
          loading={state.loading}
          onRow={(record) => ({
            onContextMenu: (e: React.MouseEvent) =>
              openCtxMenu(e, buildMenu(record)),
          })}
        />
      </div>
      {contextMenu}
    </div>
  );
}
