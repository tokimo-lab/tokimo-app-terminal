/**
 * Docker networks table for SSH Docker panel.
 * Lists networks with name, driver, scope, subnet, and gateway.
 * Right-click context menu for network actions (remove).
 */
import { useContextMenu } from "@tokiomo/components";
import { Trash2 } from "lucide-react";
import { useCallback } from "react";
import { api } from "@/generated/rust-api";
import type { DockerNetworkEntry } from "@/generated/rust-types/DockerNetworkEntry";

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

  if (loading && networks.length === 0) {
    return <div className="text-fg-muted text-xs px-3 py-2">加载中...</div>;
  }
  if (networks.length === 0) {
    return <div className="text-fg-muted text-xs px-3 py-2">无网络</div>;
  }

  return (
    <div className="relative">
      <table className="w-full border-collapse text-xs font-mono">
        <thead className="sticky top-0 bg-zinc-900/95 z-10">
          <tr className="text-fg-muted">
            <th className="px-2 py-1 text-left font-normal">NETWORK ID</th>
            <th className="px-2 py-1 text-left font-normal">NAME</th>
            <th className="px-2 py-1 text-left font-normal">DRIVER</th>
            <th className="px-2 py-1 text-left font-normal">SCOPE</th>
            <th className="px-2 py-1 text-left font-normal">SUBNET</th>
            <th className="px-2 py-1 text-left font-normal">GATEWAY</th>
            <th className="px-2 py-1 text-right font-normal w-12">操作</th>
          </tr>
        </thead>
        <tbody>
          {networks.map((n) => {
            const isProtected = PROTECTED_NETWORKS.has(n.name);
            return (
              <tr
                key={n.id}
                className="text-fg-muted hover:bg-zinc-800/50 cursor-default"
                onContextMenu={(e) => handleContextMenu(e, n)}
              >
                <td className="px-2 py-0.5 text-fg-muted text-[10px]">
                  {n.id.slice(0, 12)}
                </td>
                <td className="px-2 py-0.5 text-zinc-200">{n.name}</td>
                <td className="px-2 py-0.5 text-fg-muted">{n.driver}</td>
                <td className="px-2 py-0.5 text-fg-muted">{n.scope}</td>
                <td className="px-2 py-0.5 text-fg-muted">
                  {n.ipamSubnet || "-"}
                </td>
                <td className="px-2 py-0.5 text-fg-muted">
                  {n.ipamGateway || "-"}
                </td>
                <td className="px-2 py-0.5 text-right">
                  {!isProtected && (
                    <button
                      type="button"
                      title="删除网络"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(n.id);
                      }}
                      className="p-0.5 text-fg-muted hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {contextMenu}
    </div>
  );
}
