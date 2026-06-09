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
import type { DockerVolumeEntry } from "../../api/types";
import { useAsync } from "../../hooks/useAsync";

interface VolumeTableProps {
  terminalId: string;
  refreshKey: number;
}

export function VolumeTable({ terminalId, refreshKey }: VolumeTableProps) {
  const toast = useToast();
  const { open: openCtxMenu, contextMenu } = useContextMenu();

  const loader = useCallback(
    () => terminalApi.dockerVolumes(terminalId),
    [terminalId],
  );
  const state = useAsync(loader, [loader, refreshKey]);

  const remove = useCallback(
    async (volumeName: string) => {
      try {
        await terminalApi.dockerVolumeRm(terminalId, volumeName);
        toast.success("Volume removed");
        state.reload();
      } catch (err: unknown) {
        toast.error(
          err instanceof Error ? err.message : "Failed to remove volume",
        );
      }
    },
    [terminalId, toast, state],
  );

  const confirmRemove = useCallback(
    (v: DockerVolumeEntry) => {
      Modal.confirm({
        title: "Remove volume",
        content: `Remove volume "${v.name}"? Data will be lost.`,
        variant: "danger",
        okText: "Remove",
        okButtonProps: { danger: true },
        onOk: () => remove(v.name),
      });
    },
    [remove],
  );

  const prune = useCallback(() => {
    Modal.confirm({
      title: "Prune volumes",
      content: "Remove all unused volumes? Data will be lost.",
      variant: "danger",
      okText: "Prune",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const resp = await terminalApi.dockerPruneVolumes(terminalId);
          toast.success(resp.output.trim() || "Volumes pruned");
          state.reload();
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Prune failed");
        }
      },
    });
  }, [terminalId, toast, state]);

  const columns = useMemo<TableColumn<DockerVolumeEntry>[]>(
    () => [
      {
        title: "Name",
        key: "name",
        render: (_v, v) => (
          <span className="truncate text-zinc-200">{v.name}</span>
        ),
      },
      {
        title: "Driver",
        key: "driver",
        width: 96,
        render: (_v, v) => <span className="text-zinc-400">{v.driver}</span>,
      },
      {
        title: "Mountpoint",
        key: "mountpoint",
        render: (_v, v) => (
          <span className="truncate font-mono text-zinc-400">
            {v.mountpoint}
          </span>
        ),
      },
      {
        title: "Size",
        key: "size",
        width: 96,
        align: "right",
        render: (_v, v) => (
          <span className="tabular-nums text-zinc-400">{v.size || "-"}</span>
        ),
      },
      {
        title: "Created",
        key: "created",
        render: (_v, v) => (
          <span className="truncate text-zinc-400">{v.created}</span>
        ),
      },
      {
        title: "Actions",
        key: "actions",
        width: 64,
        align: "right",
        render: (_v, v) => (
          <button
            type="button"
            title="Remove"
            onClick={(e) => {
              e.stopPropagation();
              confirmRemove(v);
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
    (v: DockerVolumeEntry): ContextMenuItem[] => [
      { key: "header", type: "group", label: v.name },
      {
        key: "rm",
        label: "Remove",
        icon: <Trash2 size={13} />,
        danger: true,
        onClick: () => confirmRemove(v),
      },
    ],
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
          Prune volumes
        </Button>
      </div>
      {state.error ? (
        <div className="m-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {state.error}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table<DockerVolumeEntry>
          columns={columns}
          dataSource={state.data?.volumes ?? []}
          rowKey="name"
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
