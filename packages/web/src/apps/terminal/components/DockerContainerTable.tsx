/**
 * Docker containers table for SSH Docker panel.
 * Virtualized via shared SshDataTable. Right-click context menu + per-row action buttons.
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
import { useCallback, useMemo } from "react";
import { api } from "@/generated/rust-api";
import type { DockerContainerEntry } from "@/generated/rust-types/DockerContainerEntry";
import { type SshColumn, SshDataTable } from "./SshDataTable";

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
  exited: <CircleStop className="h-3 w-3 text-fg-muted" />,
  paused: <CirclePause className="h-3 w-3 text-amber-400" />,
  restarting: <RotateCw className="h-3 w-3 text-blue-400 animate-spin" />,
  dead: <CircleX className="h-3 w-3 text-red-400" />,
  created: <Box className="h-3 w-3 text-fg-muted" />,
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
                icon: <Play size={13} />,
                onClick: () => doAction(c.name, "start"),
              },
            ]
          : []),
        ...(isRunning
          ? [
              {
                key: "stop",
                label: "停止",
                icon: <Square size={13} />,
                onClick: () => doAction(c.name, "stop"),
              },
              {
                key: "restart",
                label: "重启",
                icon: <RotateCw size={13} />,
                onClick: () => doAction(c.name, "restart"),
              },
              {
                key: "pause",
                label: "暂停",
                icon: <Pause size={13} />,
                onClick: () => doAction(c.name, "pause"),
              },
            ]
          : []),
        ...(isPaused
          ? [
              {
                key: "unpause",
                label: "恢复",
                icon: <Play size={13} />,
                onClick: () => doAction(c.name, "unpause"),
              },
              {
                key: "stop-p",
                label: "停止",
                icon: <Square size={13} />,
                onClick: () => doAction(c.name, "stop"),
              },
            ]
          : []),
        {
          key: "logs",
          label: "查看日志",
          icon: <ScrollText size={13} />,
          onClick: () => onViewLogs(c.name, c.name),
        },
        {
          key: "inspect",
          label: "详细信息",
          icon: <Info size={13} />,
          onClick: () => onInspect(c.name),
        },
        ...(isStopped
          ? [
              {
                key: "rm",
                label: "删除容器",
                icon: <Trash2 size={13} />,
                danger: true,
                onClick: () => doAction(c.name, "rm"),
              },
            ]
          : []),
      ]);
    },
    [openCtxMenu, doAction, onViewLogs, onInspect],
  );

  const columns = useMemo<SshColumn<DockerContainerEntry>[]>(
    () => [
      {
        key: "state",
        header: "",
        width: "28px",
        cellClassName: "px-2 flex items-center",
        render: (c) =>
          stateIcons[c.state] || <Box className="h-3 w-3 text-fg-muted" />,
      },
      {
        key: "name",
        header: "NAME",
        width: "minmax(120px,1fr)",
        sortable: true,
        compare: (a, b) => a.name.localeCompare(b.name),
        cellClassName: "px-2 truncate text-fg-primary",
        render: (c) => c.name,
      },
      {
        key: "image",
        header: "IMAGE",
        width: "minmax(140px,1.2fr)",
        sortable: true,
        compare: (a, b) => a.image.localeCompare(b.image),
        cellClassName: "px-2 truncate font-mono text-fg-muted",
        render: (c) => c.image,
      },
      {
        key: "status",
        header: "STATUS",
        width: "minmax(120px,1fr)",
        sortable: true,
        compare: (a, b) => a.status.localeCompare(b.status),
        render: (c) => (
          <span
            className={`truncate ${
              c.state === "running"
                ? "text-green-400"
                : c.state === "paused"
                  ? "text-amber-400"
                  : "text-fg-muted"
            }`}
          >
            {c.status}
          </span>
        ),
      },
      {
        key: "ports",
        header: "PORTS",
        width: "minmax(120px,1fr)",
        cellClassName: "px-2 truncate font-mono text-fg-muted",
        render: (c) => c.ports || "-",
      },
      {
        key: "actions",
        header: "操作",
        width: "140px",
        align: "right",
        cellClassName: "px-2 flex items-center justify-end gap-0.5",
        render: (c) => {
          const isRunning = c.state === "running";
          const isPaused = c.state === "paused";
          const isStopped =
            c.state === "exited" || c.state === "dead" || c.state === "created";
          return (
            <>
              {isStopped && (
                <Btn title="启动" onClick={() => doAction(c.name, "start")}>
                  <Play className="h-2.5 w-2.5" />
                </Btn>
              )}
              {isRunning && (
                <>
                  <Btn title="停止" onClick={() => doAction(c.name, "stop")}>
                    <Square className="h-2.5 w-2.5" />
                  </Btn>
                  <Btn title="重启" onClick={() => doAction(c.name, "restart")}>
                    <RotateCw className="h-2.5 w-2.5" />
                  </Btn>
                  <Btn title="暂停" onClick={() => doAction(c.name, "pause")}>
                    <Pause className="h-2.5 w-2.5" />
                  </Btn>
                </>
              )}
              {isPaused && (
                <Btn title="恢复" onClick={() => doAction(c.name, "unpause")}>
                  <Play className="h-2.5 w-2.5" />
                </Btn>
              )}
              <Btn title="日志" onClick={() => onViewLogs(c.name, c.name)}>
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
            </>
          );
        },
      },
    ],
    [doAction, onViewLogs, onInspect],
  );

  return (
    <>
      <SshDataTable
        items={containers}
        columns={columns}
        getRowKey={(c) => c.id}
        loading={loading}
        onRefresh={onRefresh}
        searchable
        searchPlaceholder="搜索容器名 / 镜像"
        filterFn={(c, q) =>
          c.name.toLowerCase().includes(q) ||
          c.image.toLowerCase().includes(q) ||
          c.status.toLowerCase().includes(q)
        }
        emptyText="无容器"
        onRowContextMenu={handleContextMenu}
      />
      {contextMenu}
    </>
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
      className={`p-0.5 text-fg-muted hover:text-fg-primary transition-colors cursor-pointer ${className}`}
    >
      {children}
    </button>
  );
}
