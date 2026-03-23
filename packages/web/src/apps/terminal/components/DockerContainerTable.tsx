/**
 * Docker containers table for SSH Docker panel.
 * Table with status, name, image, ports, status text, and action buttons.
 * Right-click context menu for container actions.
 */
import { useContextMenu } from "@tokiomo/components";
import {
  Box,
  CircleCheck,
  CirclePause,
  CircleStop,
  CircleX,
  Info,
  Pause,
  Play,
  RotateCw,
  ScrollText,
  Square,
  Trash2,
} from "lucide-react";
import { useCallback } from "react";
import { api } from "../../generated/rust-api";
import type { DockerContainerEntry } from "../../generated/rust-types/DockerContainerEntry";

interface DockerContainerTableProps {
  terminalId: string;
  containers: DockerContainerEntry[];
  loading: boolean;
  onRefresh: () => void;
  onViewLogs: (containerId: string, name: string) => void;
  onInspect: (containerId: string) => void;
}

const stateIcons: Record<string, React.ReactNode> = {
  running: <CircleCheck className="h-3 w-3 text-green-400" />,
  exited: <CircleStop className="h-3 w-3 text-zinc-500" />,
  paused: <CirclePause className="h-3 w-3 text-amber-400" />,
  restarting: <RotateCw className="h-3 w-3 text-blue-400 animate-spin" />,
  dead: <CircleX className="h-3 w-3 text-red-400" />,
  created: <Box className="h-3 w-3 text-zinc-500" />,
};

export default function DockerContainerTable({
  terminalId,
  containers,
  loading,
  onRefresh,
  onViewLogs,
  onInspect,
}: DockerContainerTableProps) {
  const { open: openCtxMenu, contextMenu } = useContextMenu();

  const doAction = useCallback(
    async (
      containerId: string,
      action: "start" | "stop" | "restart" | "pause" | "unpause" | "rm",
    ) => {
      const fns = {
        start: api.sshTerminal.dockerStart.mutate,
        stop: api.sshTerminal.dockerStop.mutate,
        restart: api.sshTerminal.dockerRestart.mutate,
        pause: api.sshTerminal.dockerPause.mutate,
        unpause: api.sshTerminal.dockerUnpause.mutate,
        rm: api.sshTerminal.dockerRm.mutate,
      };
      try {
        await fns[action]({ id: terminalId, containerId });
        setTimeout(onRefresh, 600);
      } catch {
        // ignore
      }
    },
    [terminalId, onRefresh],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, c: DockerContainerEntry) => {
      const isRunning = c.state === "running";
      const isPaused = c.state === "paused";
      const isStopped =
        c.state === "exited" || c.state === "dead" || c.state === "created";
      openCtxMenu(e, [
        { key: "header", type: "group", label: `${c.name} (${c.image})` },
        ...(isStopped
          ? [
              {
                key: "start",
                label: "启动",
                onClick: () => doAction(c.name, "start"),
              },
            ]
          : []),
        ...(isRunning
          ? [
              {
                key: "stop",
                label: "停止",
                onClick: () => doAction(c.name, "stop"),
              },
              {
                key: "restart",
                label: "重启",
                onClick: () => doAction(c.name, "restart"),
              },
              {
                key: "pause",
                label: "暂停",
                onClick: () => doAction(c.name, "pause"),
              },
            ]
          : []),
        ...(isPaused
          ? [
              {
                key: "unpause",
                label: "恢复",
                onClick: () => doAction(c.name, "unpause"),
              },
              {
                key: "stop-p",
                label: "停止",
                onClick: () => doAction(c.name, "stop"),
              },
            ]
          : []),
        {
          key: "logs",
          label: "查看日志",
          onClick: () => onViewLogs(c.name, c.name),
        },
        { key: "inspect", label: "详细信息", onClick: () => onInspect(c.name) },
        ...(isStopped
          ? [
              {
                key: "rm",
                label: "删除容器",
                danger: true,
                onClick: () => doAction(c.name, "rm"),
              },
            ]
          : []),
      ]);
    },
    [openCtxMenu, doAction, onViewLogs, onInspect],
  );

  if (loading && containers.length === 0) {
    return <div className="text-zinc-600 text-xs px-3 py-2">加载中...</div>;
  }
  if (containers.length === 0) {
    return <div className="text-zinc-600 text-xs px-3 py-2">无容器</div>;
  }

  return (
    <div className="relative">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-zinc-900/95 z-10">
          <tr className="text-zinc-500">
            <th className="px-2 py-1 text-left font-normal w-6" />
            <th className="px-2 py-1 text-left font-normal">NAME</th>
            <th className="px-2 py-1 text-left font-normal">IMAGE</th>
            <th className="px-2 py-1 text-left font-normal">STATUS</th>
            <th className="px-2 py-1 text-left font-normal">PORTS</th>
            <th className="px-2 py-1 text-right font-normal w-28">操作</th>
          </tr>
        </thead>
        <tbody>
          {containers.map((c) => {
            const isRunning = c.state === "running";
            const isPaused = c.state === "paused";
            const isStopped =
              c.state === "exited" ||
              c.state === "dead" ||
              c.state === "created";
            return (
              <tr
                key={c.id}
                className="text-zinc-400 hover:bg-zinc-800/50 cursor-default"
                onContextMenu={(e) => handleContextMenu(e, c)}
              >
                <td className="px-2 py-0.5">
                  {stateIcons[c.state] || (
                    <Box className="h-3 w-3 text-zinc-600" />
                  )}
                </td>
                <td className="px-2 py-0.5 text-zinc-200 font-medium truncate max-w-32">
                  {c.name}
                </td>
                <td className="px-2 py-0.5 text-zinc-500 truncate max-w-40 font-mono">
                  {c.image}
                </td>
                <td className="px-2 py-0.5">
                  <span
                    className={
                      isRunning
                        ? "text-green-400"
                        : isPaused
                          ? "text-amber-400"
                          : "text-zinc-500"
                    }
                  >
                    {c.status}
                  </span>
                </td>
                <td className="px-2 py-0.5 text-zinc-500 truncate max-w-40 text-[10px] font-mono">
                  {c.ports || "-"}
                </td>
                <td className="px-2 py-0.5 text-right">
                  <div className="flex items-center justify-end gap-0.5">
                    {isStopped && (
                      <Btn
                        title="启动"
                        onClick={() => doAction(c.name, "start")}
                      >
                        <Play className="h-2.5 w-2.5" />
                      </Btn>
                    )}
                    {isRunning && (
                      <>
                        <Btn
                          title="停止"
                          onClick={() => doAction(c.name, "stop")}
                        >
                          <Square className="h-2.5 w-2.5" />
                        </Btn>
                        <Btn
                          title="重启"
                          onClick={() => doAction(c.name, "restart")}
                        >
                          <RotateCw className="h-2.5 w-2.5" />
                        </Btn>
                        <Btn
                          title="暂停"
                          onClick={() => doAction(c.name, "pause")}
                        >
                          <Pause className="h-2.5 w-2.5" />
                        </Btn>
                      </>
                    )}
                    {isPaused && (
                      <Btn
                        title="恢复"
                        onClick={() => doAction(c.name, "unpause")}
                      >
                        <Play className="h-2.5 w-2.5" />
                      </Btn>
                    )}
                    <Btn
                      title="日志"
                      onClick={() => onViewLogs(c.name, c.name)}
                    >
                      <ScrollText className="h-2.5 w-2.5" />
                    </Btn>
                    <Btn title="详情" onClick={() => onInspect(c.name)}>
                      <Info className="h-2.5 w-2.5" />
                    </Btn>
                    {isStopped && (
                      <Btn
                        title="删除"
                        onClick={() => doAction(c.name, "rm")}
                        className="hover:text-red-400"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </Btn>
                    )}
                  </div>
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

function Btn({
  title,
  onClick,
  children,
  className = "",
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors ${className}`}
    >
      {children}
    </button>
  );
}
