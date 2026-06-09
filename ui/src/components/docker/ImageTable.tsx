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
import type { DockerImageEntry } from "../../api/types";
import { useAsync } from "../../hooks/useAsync";

interface ImageTableProps {
  terminalId: string;
  refreshKey: number;
}

export function ImageTable({ terminalId, refreshKey }: ImageTableProps) {
  const toast = useToast();
  const { open: openCtxMenu, contextMenu } = useContextMenu();

  const loader = useCallback(
    () => terminalApi.dockerImages(terminalId),
    [terminalId],
  );
  const state = useAsync(loader, [loader, refreshKey]);

  const remove = useCallback(
    async (imageId: string) => {
      try {
        await terminalApi.dockerRmi(terminalId, imageId);
        toast.success("Image removed");
        state.reload();
      } catch (err: unknown) {
        toast.error(
          err instanceof Error ? err.message : "Failed to remove image",
        );
      }
    },
    [terminalId, toast, state],
  );

  const confirmRemove = useCallback(
    (img: DockerImageEntry) => {
      Modal.confirm({
        title: "Remove image",
        content: `Remove image "${img.repository}:${img.tag}"?`,
        variant: "danger",
        okText: "Remove",
        okButtonProps: { danger: true },
        onOk: () => remove(img.id),
      });
    },
    [remove],
  );

  const prune = useCallback(() => {
    Modal.confirm({
      title: "Prune images",
      content: "Remove all dangling images?",
      variant: "danger",
      okText: "Prune",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const resp = await terminalApi.dockerPruneImages(terminalId);
          toast.success(resp.output.trim() || "Images pruned");
          state.reload();
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Prune failed");
        }
      },
    });
  }, [terminalId, toast, state]);

  const columns = useMemo<TableColumn<DockerImageEntry>[]>(
    () => [
      {
        title: "Repository",
        key: "repository",
        render: (_v, i) => (
          <span className="truncate text-zinc-200">{i.repository}</span>
        ),
      },
      {
        title: "Tag",
        key: "tag",
        render: (_v, i) => (
          <span className="truncate text-zinc-400">{i.tag}</span>
        ),
      },
      {
        title: "Image ID",
        key: "id",
        width: 120,
        render: (_v, i) => (
          <span className="font-mono text-zinc-400">{i.id.slice(0, 12)}</span>
        ),
      },
      {
        title: "Size",
        key: "size",
        width: 96,
        align: "right",
        render: (_v, i) => (
          <span className="tabular-nums text-zinc-400">{i.size}</span>
        ),
      },
      {
        title: "Created",
        key: "created",
        render: (_v, i) => (
          <span className="truncate text-zinc-400">{i.created}</span>
        ),
      },
      {
        title: "Actions",
        key: "actions",
        width: 64,
        align: "right",
        render: (_v, i) => (
          <button
            type="button"
            title="Remove"
            onClick={(e) => {
              e.stopPropagation();
              confirmRemove(i);
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
    (img: DockerImageEntry): ContextMenuItem[] => [
      { key: "header", type: "group", label: `${img.repository}:${img.tag}` },
      {
        key: "rmi",
        label: "Remove",
        icon: <Trash2 size={13} />,
        danger: true,
        onClick: () => confirmRemove(img),
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
          Prune images
        </Button>
      </div>
      {state.error ? (
        <div className="m-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {state.error}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table<DockerImageEntry>
          columns={columns}
          dataSource={state.data?.images ?? []}
          rowKey={(r) => `${r.id}-${r.tag}`}
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
