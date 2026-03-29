/**
 * Docker volumes table for SSH Docker panel.
 * Lists volumes with name, driver, mountpoint, scope, created, size.
 * Right-click context menu for volume actions (remove).
 */
import { useContextMenu } from "@tokiomo/components";
import { Trash2 } from "lucide-react";
import { useCallback } from "react";
import { api } from "@/generated/rust-api";
import type { DockerVolumeEntry } from "@/generated/rust-types/DockerVolumeEntry";

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
          danger: true,
          onClick: () => handleRemove(v.name),
        },
      ]);
    },
    [openCtxMenu, handleRemove],
  );

  if (loading && volumes.length === 0) {
    return <div className="text-zinc-600 text-xs px-3 py-2">加载中...</div>;
  }
  if (volumes.length === 0) {
    return <div className="text-zinc-600 text-xs px-3 py-2">无存储卷</div>;
  }

  return (
    <div className="relative">
      <table className="w-full border-collapse text-xs font-mono">
        <thead className="sticky top-0 bg-zinc-900/95 z-10">
          <tr className="text-zinc-500">
            <th className="px-2 py-1 text-left font-normal">NAME</th>
            <th className="px-2 py-1 text-left font-normal">DRIVER</th>
            <th className="px-2 py-1 text-left font-normal">MOUNTPOINT</th>
            <th className="px-2 py-1 text-left font-normal">SCOPE</th>
            <th className="px-2 py-1 text-right font-normal">SIZE</th>
            <th className="px-2 py-1 text-left font-normal">CREATED</th>
            <th className="px-2 py-1 text-right font-normal w-12">操作</th>
          </tr>
        </thead>
        <tbody>
          {volumes.map((v) => (
            <tr
              key={v.name}
              className="text-zinc-600 dark:text-zinc-400 hover:bg-zinc-800/50 cursor-default"
              onContextMenu={(e) => handleContextMenu(e, v)}
            >
              <td className="px-2 py-0.5 text-zinc-200 truncate max-w-40">
                {v.name.length > 20 ? `${v.name.slice(0, 20)}…` : v.name}
              </td>
              <td className="px-2 py-0.5 text-zinc-500">{v.driver}</td>
              <td className="px-2 py-0.5 text-zinc-600 truncate max-w-48 text-[10px]">
                {v.mountpoint}
              </td>
              <td className="px-2 py-0.5 text-zinc-600">{v.scope}</td>
              <td className="px-2 py-0.5 text-right tabular-nums text-zinc-500">
                {v.size || "-"}
              </td>
              <td className="px-2 py-0.5 text-zinc-600">{v.created}</td>
              <td className="px-2 py-0.5 text-right">
                <button
                  type="button"
                  title="删除卷"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(v.name);
                  }}
                  className="p-0.5 text-zinc-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {contextMenu}
    </div>
  );
}
