/**
 * Terminal 类型媒体库页面
 *
 * 显示 SSH 终端连接列表，支持新建/编辑/删除连接。
 * 双击连接打开全局任务窗口中的 xterm.js SSH 终端。
 */

import { Button, Empty, Modal, Spin } from "@tokiomo/components";
import { Monitor, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import SshTerminalForm from "../../components/terminal/SshTerminalForm";
import { useWindowManager } from "../../contexts/WindowManagerContext";
import {
  api,
  type CreateSshTerminalInput,
  type SshTerminalOutput,
  type UpdateSshTerminalInput,
} from "../../generated/rust-api";

export default function TerminalLibraryPage() {
  const { id: libraryId } = useParams<{ id: string }>();
  const { openWindow } = useWindowManager();
  const [formOpen, setFormOpen] = useState(false);
  const [editingTerminal, setEditingTerminal] =
    useState<SshTerminalOutput | null>(null);

  const libraryQuery = api.mediaLibrary.getById.useQuery(
    { id: libraryId! },
    { enabled: !!libraryId },
  );

  const terminalsQuery = api.sshTerminal.list.useQuery(
    { libraryId: libraryId! },
    { enabled: !!libraryId },
  );

  const createMutation = api.sshTerminal.create.useMutation({
    onSuccess: () => {
      terminalsQuery.refetch();
      setFormOpen(false);
    },
  });

  const updateMutation = api.sshTerminal.update.useMutation({
    onSuccess: () => {
      terminalsQuery.refetch();
      setFormOpen(false);
      setEditingTerminal(null);
    },
  });

  const deleteMutation = api.sshTerminal.delete.useMutation({
    onSuccess: () => terminalsQuery.refetch(),
  });

  const handleFormSubmit = useCallback(
    (data: CreateSshTerminalInput | UpdateSshTerminalInput) => {
      if (editingTerminal) {
        updateMutation.mutate(data as UpdateSshTerminalInput);
      } else {
        createMutation.mutate(data as CreateSshTerminalInput);
      }
    },
    [editingTerminal, createMutation, updateMutation],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
    },
    [deleteMutation],
  );

  const handleOpenTerminal = useCallback(
    (terminal: SshTerminalOutput) => {
      openWindow({
        type: "terminal",
        title: `${terminal.name} (${terminal.host})`,
        libraryId,
        sourceType: "ssh_terminal",
        sourceId: terminal.id,
        metadata: {
          sshTerminalId: terminal.id,
          sshHost: terminal.host,
        },
      });
    },
    [openWindow, libraryId],
  );

  if (libraryQuery.isLoading || terminalsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spin />
      </div>
    );
  }

  const library = libraryQuery.data;
  const terminals = terminalsQuery.data ?? [];

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-100">
          {library?.name ?? "Terminal"}
        </h1>
        <Button
          variant="primary"
          size="small"
          onClick={() => {
            setEditingTerminal(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          新建终端
        </Button>
      </div>

      {/* Terminal List */}
      {terminals.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <Empty description="暂无终端连接，点击右上角新建" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {terminals.map((terminal) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: double-click to open terminal
            <div
              key={terminal.id}
              className="group relative rounded-xl border border-zinc-700/50 bg-zinc-800/50 backdrop-blur-sm p-4 cursor-pointer transition-all hover:border-zinc-600 hover:bg-zinc-800/80"
              onDoubleClick={() => handleOpenTerminal(terminal)}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Monitor className="h-5 w-5 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-zinc-200 truncate">
                    {terminal.name}
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5 truncate">
                    {terminal.username}@{terminal.host}:{terminal.port}
                  </p>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    {terminal.authMethod === "private_key"
                      ? "密钥认证"
                      : "密码认证"}
                  </p>
                </div>
              </div>

              {/* Actions (visible on hover) */}
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  title="连接"
                  className="p-1.5 rounded-md bg-emerald-600/70 hover:bg-emerald-500 text-zinc-200 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenTerminal(terminal);
                  }}
                >
                  <Play className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="编辑"
                  className="p-1.5 rounded-md bg-zinc-700/70 hover:bg-zinc-600 text-zinc-400 hover:text-zinc-200 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingTerminal(terminal);
                    setFormOpen(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="删除"
                  className="p-1.5 rounded-md bg-zinc-700/70 hover:bg-red-600/80 text-zinc-400 hover:text-zinc-200 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(terminal.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal
        open={formOpen}
        onCancel={() => {
          setFormOpen(false);
          setEditingTerminal(null);
        }}
        title={editingTerminal ? "编辑终端" : "新建终端"}
        width={480}
      >
        <SshTerminalForm
          libraryId={libraryId!}
          terminal={editingTerminal}
          onSubmit={handleFormSubmit}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      </Modal>
    </div>
  );
}
