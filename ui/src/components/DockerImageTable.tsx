/**
 * Docker images table for SSH Docker panel.
 * Virtualized via shared SshDataTable.
 */
import { useContextMenu } from "@tokimo/ui";
import { Eraser, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { terminalApi } from "../api/client";
import type { DockerImageEntry } from "../api/types";
import { type SshColumn, SshDataTable } from "./SshDataTable";

interface DockerImageTableProps {
  terminalId: string;
  images: DockerImageEntry[];
  loading: boolean;
  onRefresh: () => void;
}

export default function DockerImageTable({
  terminalId,
  images,
  loading,
  onRefresh,
}: DockerImageTableProps) {
  const { open: openCtxMenu, contextMenu } = useContextMenu();
  const [pruneMsg, setPruneMsg] = useState<string | null>(null);

  const handleRemove = useCallback(
    async (imageId: string) => {
      try {
        await terminalApi.dockerRmi(terminalId, imageId);
        setTimeout(onRefresh, 600);
      } catch {
        // ignore
      }
    },
    [terminalId, onRefresh],
  );

  const handlePrune = useCallback(async () => {
    try {
      const resp = await terminalApi.dockerPruneImages(terminalId);
      setPruneMsg(resp.output);
      setTimeout(() => setPruneMsg(null), 4000);
      setTimeout(onRefresh, 600);
    } catch {
      // ignore
    }
  }, [terminalId, onRefresh]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, img: DockerImageEntry) => {
      openCtxMenu(e, [
        {
          key: "header",
          type: "group",
          label: `${img.repository}:${img.tag}`,
        },
        {
          key: "rmi",
          label: "删除镜像",
          icon: <Trash2 size={13} />,
          danger: true,
          onClick: () => handleRemove(img.id),
        },
      ]);
    },
    [openCtxMenu, handleRemove],
  );

  const columns = useMemo<SshColumn<DockerImageEntry>[]>(
    () => [
      {
        key: "repository",
        header: "REPOSITORY",
        width: "minmax(140px,1.5fr)",
        sortable: true,
        compare: (a, b) => a.repository.localeCompare(b.repository),
        cellClassName: "px-2 truncate text-fg-primary",
        render: (i) => i.repository,
      },
      {
        key: "tag",
        header: "TAG",
        width: "minmax(80px,1fr)",
        sortable: true,
        compare: (a, b) => a.tag.localeCompare(b.tag),
        cellClassName: "px-2 truncate text-fg-muted",
        render: (i) => i.tag,
      },
      {
        key: "id",
        header: "IMAGE ID",
        width: "110px",
        cellClassName: "px-2 truncate text-fg-muted",
        render: (i) => i.id.slice(0, 12),
      },
      {
        key: "size",
        header: "SIZE",
        width: "90px",
        align: "right",
        sortable: true,
        compare: (a, b) => a.size.localeCompare(b.size),
        cellClassName: "px-2 text-right tabular-nums text-fg-muted",
        render: (i) => i.size,
      },
      {
        key: "created",
        header: "CREATED",
        width: "minmax(100px,1fr)",
        cellClassName: "px-2 truncate text-fg-muted",
        render: (i) => i.created,
      },
      {
        key: "actions",
        header: "操作",
        width: "56px",
        align: "right",
        cellClassName: "px-2 flex items-center justify-end",
        render: (i) => (
          <button
            type="button"
            title="删除镜像"
            onClick={(e) => {
              e.stopPropagation();
              handleRemove(i.id);
            }}
            className="p-0.5 text-fg-muted hover:text-red-400 transition-colors cursor-pointer"
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        ),
      },
    ],
    [handleRemove],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {pruneMsg && (
        <div className="px-3 py-1 text-[11px] text-green-400 bg-green-400/5 border-b border-black/[0.08] dark:border-zinc-800/60 shrink-0">
          {pruneMsg}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <SshDataTable
          items={images}
          columns={columns}
          getRowKey={(i) => `${i.id}-${i.tag}`}
          loading={loading}
          onRefresh={onRefresh}
          searchable
          searchPlaceholder="搜索镜像"
          filterFn={(i, q) =>
            i.repository.toLowerCase().includes(q) ||
            i.tag.toLowerCase().includes(q) ||
            i.id.toLowerCase().includes(q)
          }
          toolbarRight={
            <button
              type="button"
              onClick={handlePrune}
              className="flex items-center gap-1 text-xs text-fg-muted hover:text-amber-400 transition-colors cursor-pointer px-1"
              title="清理未使用镜像"
            >
              <Eraser className="h-3 w-3" />
              清理
            </button>
          }
          emptyText="无镜像"
          onRowContextMenu={handleContextMenu}
        />
      </div>
      {contextMenu}
    </div>
  );
}
