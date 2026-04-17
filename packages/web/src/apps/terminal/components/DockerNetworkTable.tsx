/**
 * Docker networks table for SSH Docker panel.
 * Virtualized via shared SshDataTable.
 */
import { useContextMenu } from "@tokiomo/components";
import { Trash2 } from "lucide-react";
import { useCallback, useMemo } from "react";
import { api } from "@/generated/rust-api";
import type { DockerNetworkEntry } from "@/generated/rust-types/DockerNetworkEntry";
import { type SshColumn, SshDataTable } from "./SshDataTable";

/** Built-in networks that cannot be removed */
const PROTECTED_NETWORKS = new Set(["bridge", "host", "none"]);

interface DockerNetworkTableProps {
  terminalId: string;
  networks: DockerNetworkEntry[];
  loading: boolean;
  onRefresh: () => void;
}

export default function DockerNetworkTable({
  terminalId,
  networks,
  loading,
  onRefresh,
}: DockerNetworkTableProps) {
  const { open: openCtxMenu, contextMenu } = useContextMenu();

  const handleRemove = useCallback(
    async (networkId: string) => {
      try {
        await api.sshTerminal.dockerNetworkRm.mutate({
          id: terminalId,
          networkId,
        });
        setTimeout(onRefresh, 600);
      } catch {
        // ignore
      }
    },
    [terminalId, onRefresh],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, n: DockerNetworkEntry) => {
      const isProtected = PROTECTED_NETWORKS.has(n.name);
      openCtxMenu(e, [
        { key: "header", type: "group", label: n.name },
        ...(!isProtected
          ? [
              {
                key: "rm",
                label: "删除网络",
                icon: <Trash2 size={13} />,
                danger: true,
                onClick: () => handleRemove(n.id),
              },
            ]
          : []),
      ]);
    },
    [openCtxMenu, handleRemove],
  );

  const columns = useMemo<SshColumn<DockerNetworkEntry>[]>(
    () => [
      {
        key: "id",
        header: "NETWORK ID",
        width: "110px",
        cellClassName: "px-2 truncate text-fg-muted",
        render: (n) => n.id.slice(0, 12),
      },
      {
        key: "name",
        header: "NAME",
        width: "minmax(120px,1fr)",
        sortable: true,
        compare: (a, b) => a.name.localeCompare(b.name),
        cellClassName: "px-2 truncate text-fg-primary",
        render: (n) => n.name,
      },
      {
        key: "driver",
        header: "DRIVER",
        width: "100px",
        sortable: true,
        compare: (a, b) => a.driver.localeCompare(b.driver),
        cellClassName: "px-2 truncate text-fg-muted",
        render: (n) => n.driver,
      },
      {
        key: "scope",
        header: "SCOPE",
        width: "90px",
        cellClassName: "px-2 truncate text-fg-muted",
        render: (n) => n.scope,
      },
      {
        key: "subnet",
        header: "SUBNET",
        width: "minmax(120px,1fr)",
        cellClassName: "px-2 truncate text-fg-muted",
        render: (n) => n.ipamSubnet || "-",
      },
      {
        key: "gateway",
        header: "GATEWAY",
        width: "minmax(120px,1fr)",
        cellClassName: "px-2 truncate text-fg-muted",
        render: (n) => n.ipamGateway || "-",
      },
      {
        key: "actions",
        header: "操作",
        width: "56px",
        align: "right",
        cellClassName: "px-2 flex items-center justify-end",
        render: (n) =>
          PROTECTED_NETWORKS.has(n.name) ? null : (
            <button
              type="button"
              title="删除网络"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(n.id);
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
        items={networks}
        columns={columns}
        getRowKey={(n) => n.id}
        loading={loading}
        onRefresh={onRefresh}
        searchable
        searchPlaceholder="搜索网络"
        filterFn={(n, q) =>
          n.name.toLowerCase().includes(q) ||
          n.driver.toLowerCase().includes(q) ||
          (n.ipamSubnet || "").toLowerCase().includes(q)
        }
        emptyText="无网络"
        onRowContextMenu={handleContextMenu}
      />
      {contextMenu}
    </>
  );
}
