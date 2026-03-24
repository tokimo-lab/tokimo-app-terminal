/**
 * Terminal 类型应用页面
 *
 * 显示 SSH 终端连接列表，支持新建/编辑/删除连接。
 * 双击连接打开全局任务窗口中的 xterm.js SSH 终端。
 */

import { Button, Empty, Modal, Spin } from "@tokiomo/components";
import { Monitor, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import SshTerminalForm from "../../components/terminal/SshTerminalForm";
import { useWindowNav } from "../../components/window-manager/WindowNavContext";
import {
  api,
  type CreateSshTerminalInput,
  type SshTerminalOutput,
  type UpdateSshTerminalInput,
} from "../../generated/rust-api";

export default function TerminalAppPage() {
  const { params, openWindow } = useWindowNav();
  const appId = params.appId as string | undefined;
  const [formOpen, setFormOpen] = useState(false);
  const [editingTerminal, setEditingTerminal] =
    useState<SshTerminalOutput | null>(null);

  const libraryQuery = api.app.getById.useQuery(
    { id: appId! },
    { enabled: !!appId },
  );

  const terminalsQuery = api.sshTerminal.list.useQuery(
    { appId: appId! },
    { enabled: !!appId },
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
    (terminal: SshTerminalOutput) => {
      Modal.confirm({
        title: "删除终端",
        content: `确定要删除终端「${terminal.name}」吗？此操作不可撤销。`,
        okText: "删除",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: () => deleteMutation.mutateAsync(terminal.id),
      });
    },
    [deleteMutation],
  );

  const handleOpenTerminal = useCallback(
    (terminal: SshTerminalOutput) => {
      openWindow({
        type: "terminal",
        title: `${terminal.username}@${terminal.host}`,
        appId,
        sourceType: "ssh_terminal",
        sourceId: terminal.id,
        metadata: {
          sshTerminalId: terminal.id,
          sshHost: terminal.host,
          sshFileSystemId: terminal.fileSystemId ?? undefined,
          sshSessionId: crypto.randomUUID(),
        },
      });
    },
    [openWindow, appId],
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
    <div className="h-full flex flex-col p-4 gap-4 rounded-xl bg-white/50 dark:bg-white/[0.03] backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
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
              className="group relative rounded-xl border border-black/[0.06] bg-white/60 backdrop-blur-sm p-4 cursor-pointer transition-all hover:border-black/[0.12] hover:bg-white/80 dark:border-white/[0.08] dark:bg-white/[0.06] dark:hover:border-white/[0.15] dark:hover:bg-white/[0.1]"
              onDoubleClick={() => handleOpenTerminal(terminal)}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/15 flex items-center justify-center">
                  <Monitor className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-200 truncate">
                    {terminal.name}
                  </h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">
                    {terminal.username}@{terminal.host}:{terminal.port}
                  </p>
                  <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
                    {terminal.authMethod === "private_key"
                      ? "密钥认证"
                      : "密码认证"}
                  </p>
                  {terminal.notes && (
                    <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 line-clamp-2">
                      {terminal.notes}
                    </p>
                  )}
                </div>
              </div>

              {/* Actions (visible on hover) */}
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  title="连接"
                  className="p-1.5 rounded-md bg-emerald-500/80 hover:bg-emerald-500 text-white transition-colors"
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
                  className="p-1.5 rounded-md bg-black/10 hover:bg-black/20 text-neutral-500 hover:text-neutral-700 dark:bg-white/10 dark:hover:bg-white/20 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors"
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
                  className="p-1.5 rounded-md bg-black/10 hover:bg-red-500/80 text-neutral-500 hover:text-white dark:bg-white/10 dark:hover:bg-red-600/80 dark:text-neutral-400 dark:hover:text-white transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(terminal);
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
        footer={null}
      >
        <SshTerminalForm
          appId={appId!}
          terminal={editingTerminal}
          onSubmit={handleFormSubmit}
          onCancel={() => {
            setFormOpen(false);
            setEditingTerminal(null);
          }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      </Modal>
    </div>
  );
}
