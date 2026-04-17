/**
 * Docker volumes table for SSH Docker panel.
 * Virtualized via shared SshDataTable.
 */
import { useContextMenu } from "@tokiomo/components";
import { Trash2 } from "lucide-react";
import { useCallback, useMemo } from "react";
import { api } from "@/generated/rust-api";
import type { DockerVolumeEntry } from "@/generated/rust-types/DockerVolumeEntry";
import { type SshColumn, SshDataTable } from "./SshDataTable";

interface DockerVolumeTableProps {
  terminalId: string;
  volumes: DockerVolumeEntry[];
  loading: boolean;
  onRefresh: () => void;
}

export default function DockerVolumeTable({
  terminalId,
  volumes,
  loading,
  onRefresh,
}: DockerVolumeTableProps) {
  const { open: openCtxMenu, contextMenu } = useContextMenu();

  const handleRemove = useCallback(
    async (volumeName: string) => {
      try {
        await api.sshTerminal.dockerVolumeRm.mutate({
          id: terminalId,
          volumeName,
        });
        setTimeout(onRefresh, 600);
      } catch {
        // ignore
      }
    },
    [terminalId, onRefresh],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, v: DockerVolumeEntry) => {
      openCtxMenu(e, [
        { key: "header", type: "group", label: v.name },
        {
          key: "rm",
          label: "删除卷",
          icon: <Trash2 size={13} />,
          danger: true,
          onClick: () => handleRemove(v.name),
        },
      ]);
    },
    [openCtxMenu, handleRemove],
  );

  const columns = useMemo<SshColumn<DockerVolumeEntry>[]>(
    () => [
      {
        key: "name",
        header: "NAME",
        width: "minmax(140px,1.2fr)",
        sortable: true,
        compare: (a, b) => a.name.localeCompare(b.name),
        cellClassName: "px-2 truncate text-fg-primary",
        render: (v) => v.name,
      },
      {
        key: "driver",
        header: "DRIVER",
        width: "90px",
        sortable: true,
        compare: (a, b) => a.driver.localeCompare(b.driver),
        cellClassName: "px-2 truncate text-fg-muted",
        render: (v) => v.driver,
      },
      {
        key: "mountpoint",
        header: "MOUNTPOINT",
        width: "minmax(160px,1.5fr)",
        cellClassName: "px-2 truncate text-fg-muted",
        render: (v) => v.mountpoint,
      },
      {
        key: "scope",
        header: "SCOPE",
        width: "90px",
        cellClassName: "px-2 truncate text-fg-muted",
        render: (v) => v.scope,
      },
      {
        key: "size",
        header: "SIZE",
        width: "90px",
        align: "right",
        cellClassName: "px-2 text-right tabular-nums text-fg-muted",
        render: (v) => v.size || "-",
      },
      {
        key: "created",
        header: "CREATED",
        width: "minmax(100px,1fr)",
        cellClassName: "px-2 truncate text-fg-muted",
        render: (v) => v.created,
      },
      {
        key: "actions",
        header: "操作",
        width: "56px",
        align: "right",
        cellClassName: "px-2 flex items-center justify-end",
        render: (v) => (
          <button
            type="button"
            title="删除卷"
            onClick={(e) => {
              e.stopPropagation();
              handleRemove(v.name);
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
    <>
      <SshDataTable
        items={volumes}
        columns={columns}
        getRowKey={(v) => v.name}
        loading={loading}
        onRefresh={onRefresh}
        searchable
        searchPlaceholder="搜索存储卷"
        filterFn={(v, q) =>
          v.name.toLowerCase().includes(q) ||
          v.driver.toLowerCase().includes(q) ||
          v.mountpoint.toLowerCase().includes(q)
        }
        emptyText="无存储卷"
        onRowContextMenu={handleContextMenu}
      />
      {contextMenu}
    </>
  );
}
