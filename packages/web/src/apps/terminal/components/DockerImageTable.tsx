/**
 * Docker images table for SSH Docker panel.
 * Lists images with repository, tag, ID, size, and created info.
 * Right-click context menu for image actions (remove).
 */
import { useContextMenu } from "@tokiomo/components";
import { Eraser, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { api } from "@/generated/rust-api";
import type { DockerImageEntry } from "@/generated/rust-types/DockerImageEntry";

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
        await api.sshTerminal.dockerRmi.mutate({ id: terminalId, imageId });
        setTimeout(onRefresh, 600);
      } catch {
        // ignore
      }
    },
    [terminalId, onRefresh],
  );

  const handlePrune = useCallback(async () => {
    try {
      const resp = await api.sshTerminal.dockerPruneImages.mutate({
        id: terminalId,
      });
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
          danger: true,
          onClick: () => handleRemove(img.id),
        },
      ]);
    },
    [openCtxMenu, handleRemove],
  );

  if (loading && images.length === 0) {
    return <div className="text-zinc-600 text-xs px-3 py-2">加载中...</div>;
  }
  if (images.length === 0) {
    return <div className="text-zinc-600 text-xs px-3 py-2">无镜像</div>;
  }

  return (
    <div className="relative">
      {pruneMsg && (
        <div className="px-3 py-1 text-[11px] text-green-400 bg-green-400/5 border-b border-zinc-800/60">
          {pruneMsg}
        </div>
      )}
      <div className="flex items-center justify-end px-2 py-0.5 border-b border-zinc-800/40">
        <button
          type="button"
          onClick={handlePrune}
          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-amber-400 transition-colors"
          title="清理未使用镜像"
        >
          <Eraser className="h-2.5 w-2.5" />
          清理
        </button>
      </div>
      <table className="w-full border-collapse text-xs font-mono">
        <thead className="sticky top-0 bg-zinc-900/95 z-10">
          <tr className="text-zinc-500">
            <th className="px-2 py-1 text-left font-normal">REPOSITORY</th>
            <th className="px-2 py-1 text-left font-normal">TAG</th>
            <th className="px-2 py-1 text-left font-normal">IMAGE ID</th>
            <th className="px-2 py-1 text-right font-normal">SIZE</th>
            <th className="px-2 py-1 text-left font-normal">CREATED</th>
            <th className="px-2 py-1 text-right font-normal w-12">操作</th>
          </tr>
        </thead>
        <tbody>
          {images.map((img) => (
            <tr
              key={`${img.id}-${img.tag}`}
              className="text-zinc-600 dark:text-zinc-400 hover:bg-zinc-800/50 cursor-default"
              onContextMenu={(e) => handleContextMenu(e, img)}
            >
              <td className="px-2 py-0.5 truncate max-w-40">
                {img.repository}
              </td>
              <td className="px-2 py-0.5 text-zinc-500">{img.tag}</td>
              <td className="px-2 py-0.5 text-zinc-600 text-[10px]">
                {img.id.slice(0, 12)}
              </td>
              <td className="px-2 py-0.5 text-right tabular-nums text-zinc-500">
                {img.size}
              </td>
              <td className="px-2 py-0.5 text-zinc-600">{img.created}</td>
              <td className="px-2 py-0.5 text-right">
                <button
                  type="button"
                  title="删除镜像"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(img.id);
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
