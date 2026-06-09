import {
  type ContextMenuItem,
  Empty,
  Modal,
  Table,
  type TableColumn,
  useContextMenu,
  useToast,
} from "@tokimo/ui";
import {
  Info,
  Pause,
  Play,
  RotateCw,
  ScrollText,
  Square,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { terminalApi } from "../../api/client";
import type { DockerContainerEntry } from "../../api/types";
import { useAsync } from "../../hooks/useAsync";
import { InspectView } from "./InspectView";
import { LogsView } from "./LogsView";

interface ContainerTableProps {
  terminalId: string;
  refreshKey: number;
}

type ContainerAction =
  | "start"
  | "stop"
  | "restart"
  | "pause"
  | "unpause"
  | "rm";

const STOPPED_STATES = new Set(["exited", "dead", "created"]);

function stateBadgeClass(state: string): string {
  if (state === "running") return "bg-green-500/15 text-green-400";
  if (state === "paused") return "bg-amber-500/15 text-amber-400";
  return "bg-zinc-500/15 text-zinc-400";
}

export function ContainerTable({
  terminalId,
  refreshKey,
}: ContainerTableProps) {
  const toast = useToast();
  const { open: openCtxMenu, contextMenu } = useContextMenu();
  const [logsTarget, setLogsTarget] = useState<DockerContainerEntry | null>(
    null,
  );
  const [inspectTarget, setInspectTarget] = useState<string | null>(null);

  const loader = useCallback(
    () => terminalApi.dockerPs(terminalId),
    [terminalId],
  );
  const state = useAsync(loader, [loader, refreshKey]);

  const doAction = useCallback(
    async (containerId: string, action: ContainerAction) => {
      const run = {
        start: terminalApi.dockerStart,
        stop: terminalApi.dockerStop,
        restart: terminalApi.dockerRestart,
        pause: terminalApi.dockerPause,
        unpause: terminalApi.dockerUnpause,
        rm: terminalApi.dockerRm,
      }[action];
      try {
        await run(terminalId, containerId);
        toast.success(`Container ${action} succeeded`);
        state.reload();
      } catch (err: unknown) {
        toast.error(
          err instanceof Error ? err.message : `Container ${action} failed`,
        );
      }
    },
    [terminalId, toast, state],
  );

  const confirmRemove = useCallback(
    (c: DockerContainerEntry) => {
      Modal.confirm({
        title: "Remove container",
        content: `Remove container "${c.name}"? This cannot be undone.`,
        variant: "danger",
        okText: "Remove",
        okButtonProps: { danger: true },
        onOk: () => doAction(c.name, "rm"),
      });
    },
    [doAction],
  );

  const buildMenu = useCallback(
    (c: DockerContainerEntry): ContextMenuItem[] => {
      const isRunning = c.state === "running";
      const isPaused = c.state === "paused";
      const isStopped = STOPPED_STATES.has(c.state);
      const items: ContextMenuItem[] = [
        { key: "header", type: "group", label: `${c.name} (${c.image})` },
      ];
      if (isStopped) {
        items.push({
          key: "start",
          label: "Start",
          icon: <Play size={13} />,
          onClick: () => void doAction(c.name, "start"),
        });
      }
      if (isRunning) {
        items.push(
          {
            key: "stop",
            label: "Stop",
            icon: <Square size={13} />,
            onClick: () => void doAction(c.name, "stop"),
          },
          {
            key: "restart",
            label: "Restart",
            icon: <RotateCw size={13} />,
            onClick: () => void doAction(c.name, "restart"),
          },
          {
            key: "pause",
            label: "Pause",
            icon: <Pause size={13} />,
            onClick: () => void doAction(c.name, "pause"),
          },
        );
      }
      if (isPaused) {
        items.push(
          {
            key: "unpause",
            label: "Unpause",
            icon: <Play size={13} />,
            onClick: () => void doAction(c.name, "unpause"),
          },
          {
            key: "stop-p",
            label: "Stop",
            icon: <Square size={13} />,
            onClick: () => void doAction(c.name, "stop"),
          },
        );
      }
      items.push(
        {
          key: "logs",
          label: "Logs",
          icon: <ScrollText size={13} />,
          onClick: () => setLogsTarget(c),
        },
        {
          key: "inspect",
          label: "Inspect",
          icon: <Info size={13} />,
          onClick: () => setInspectTarget(c.name),
        },
      );
      if (isStopped) {
        items.push({
          key: "rm",
          label: "Remove",
          icon: <Trash2 size={13} />,
          danger: true,
          onClick: () => confirmRemove(c),
        });
      }
      return items;
    },
    [doAction, confirmRemove],
  );

  const columns = useMemo<TableColumn<DockerContainerEntry>[]>(
    () => [
      {
        title: "Name",
        key: "name",
        render: (_v, c) => (
          <span className="truncate text-zinc-200">{c.name}</span>
        ),
      },
      {
        title: "Image",
        key: "image",
        render: (_v, c) => (
          <span className="truncate font-mono text-zinc-400">{c.image}</span>
        ),
      },
      {
        title: "State",
        key: "state",
        width: 96,
        render: (_v, c) => (
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${stateBadgeClass(c.state)}`}
          >
            {c.state}
          </span>
        ),
      },
      {
        title: "Status",
        key: "status",
        render: (_v, c) => (
          <span className="truncate text-zinc-400">{c.status}</span>
        ),
      },
      {
        title: "Ports",
        key: "ports",
        render: (_v, c) => (
          <span className="truncate font-mono text-zinc-400">
            {c.ports || "-"}
          </span>
        ),
      },
      {
        title: "Actions",
        key: "actions",
        width: 168,
        align: "right",
        render: (_v, c) => {
          const isRunning = c.state === "running";
          const isPaused = c.state === "paused";
          const isStopped = STOPPED_STATES.has(c.state);
          return (
            <div className="flex items-center justify-end gap-0.5">
              {isStopped ? (
                <ActionButton
                  title="Start"
                  onClick={() => void doAction(c.name, "start")}
                >
                  <Play className="h-3 w-3" />
                </ActionButton>
              ) : null}
              {isRunning ? (
                <>
                  <ActionButton
                    title="Stop"
                    onClick={() => void doAction(c.name, "stop")}
                  >
                    <Square className="h-3 w-3" />
                  </ActionButton>
                  <ActionButton
                    title="Restart"
                    onClick={() => void doAction(c.name, "restart")}
                  >
                    <RotateCw className="h-3 w-3" />
                  </ActionButton>
                  <ActionButton
                    title="Pause"
                    onClick={() => void doAction(c.name, "pause")}
                  >
                    <Pause className="h-3 w-3" />
                  </ActionButton>
                </>
              ) : null}
              {isPaused ? (
                <ActionButton
                  title="Unpause"
                  onClick={() => void doAction(c.name, "unpause")}
                >
                  <Play className="h-3 w-3" />
                </ActionButton>
              ) : null}
              <ActionButton title="Logs" onClick={() => setLogsTarget(c)}>
                <ScrollText className="h-3 w-3" />
              </ActionButton>
              <ActionButton
                title="Inspect"
                onClick={() => setInspectTarget(c.name)}
              >
                <Info className="h-3 w-3" />
              </ActionButton>
              {isStopped ? (
                <ActionButton
                  title="Remove"
                  danger
                  onClick={() => confirmRemove(c)}
                >
                  <Trash2 className="h-3 w-3" />
                </ActionButton>
              ) : null}
            </div>
          );
        },
      },
    ],
    [doAction, confirmRemove],
  );

  if (state.data && state.data.available === false) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty description="Docker not available on this host" />
      </div>
    );
  }

  return (
    <>
      {state.error ? (
        <div className="m-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {state.error}
        </div>
      ) : null}
      <Table<DockerContainerEntry>
        columns={columns}
        dataSource={state.data?.containers ?? []}
        rowKey="id"
        size="small"
        pagination={false}
        loading={state.loading}
        onRow={(record) => ({
          onContextMenu: (e: React.MouseEvent) =>
            openCtxMenu(e, buildMenu(record)),
        })}
      />
      {contextMenu}
      {logsTarget ? (
        <LogsView
          terminalId={terminalId}
          containerId={logsTarget.name}
          name={logsTarget.name}
          onClose={() => setLogsTarget(null)}
        />
      ) : null}
      {inspectTarget ? (
        <InspectView
          terminalId={terminalId}
          containerId={inspectTarget}
          onClose={() => setInspectTarget(null)}
        />
      ) : null}
    </>
  );
}

function ActionButton({
  title,
  onClick,
  danger = false,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`cursor-pointer rounded p-1 text-zinc-400 transition-colors hover:bg-white/10 ${danger ? "hover:text-red-400" : "hover:text-zinc-100"}`}
    >
      {children}
    </button>
  );
}
