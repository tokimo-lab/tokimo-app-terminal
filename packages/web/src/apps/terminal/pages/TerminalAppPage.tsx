/**
 * Terminal 类型应用页面
 *
 * 显示 SSH 终端连接列表，支持新建/编辑/删除连接。
 * 双击连接打开全局任务窗口中的 xterm.js SSH 终端。
 */

import { Button, Modal, Spin } from "@tokiomo/components";
import { ArrowLeft, Monitor, Plus } from "lucide-react";
import { useCallback } from "react";
import SshTerminalForm from "../../components/terminal/SshTerminalForm";
import { useWindowNav } from "../../components/window-manager/WindowNavContext";
import {
  api,
  type CreateSshTerminalInput,
  type SshTerminalOutput,
  type UpdateSshTerminalInput,
} from "../../generated/rust-api";

export default function TerminalAppPage() {
  const { params } = useWindowNav();
  const appId = params.appId as string | undefined;
  const subView = params.terminalSubView as "create" | "edit" | undefined;
  const editTerminalId = params.editTerminalId as string | undefined;

  if (subView === "create") {
    return <TerminalCreateView appId={appId!} />;
  }
  if (subView === "edit" && editTerminalId) {
    return <TerminalEditView appId={appId!} terminalId={editTerminalId} />;
  }

  return <TerminalCardGrid appId={appId} />;
}

// ── Card Grid (main view) ──

function TerminalCardGrid({ appId }: { appId: string | undefined }) {
  const { openWindow, navigate } = useWindowNav();

  const terminalsQuery = api.sshTerminal.list.useQuery(
    { appId: appId! },
    { enabled: !!appId },
  );

  const deleteMutation = api.sshTerminal.delete.useMutation({
    onSuccess: () => terminalsQuery.refetch(),
  });

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

  if (terminalsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spin />
      </div>
    );
  }

  const terminals = terminalsQuery.data ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {terminals.map((terminal) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: double-click to open terminal
          <div
            key={terminal.id}
            className="group relative flex h-[89px] flex-col rounded-xl border transition-all border-[var(--glass-border)] bg-[var(--bg-glass)] hover:border-[var(--glass-border-hover)] hover:bg-[var(--bg-glass-hover)] cursor-pointer"
            onDoubleClick={() => handleOpenTerminal(terminal)}
          >
            {/* Content */}
            <div className="flex-1 px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span className="truncate font-medium text-sm text-[var(--text-primary)]">
                  {terminal.name}
                </span>
                <span className="shrink-0 ml-auto text-xs text-[var(--text-quaternary)] tabular-nums">
                  {terminal.username}@{terminal.host}:{terminal.port}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--text-quaternary)] truncate pl-6">
                {terminal.notes || "\u00A0"}
              </p>
            </div>

            {/* Actions: 3 equal buttons with CSS dividers */}
            <div className="flex items-center border-t border-[var(--glass-border)]">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenTerminal(terminal);
                }}
                className="flex-1 cursor-pointer border-r border-[var(--glass-border)] py-2 text-center text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-emerald-500 hover:bg-[var(--bg-glass-hover)]"
              >
                连接
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate("编辑终端", {
                    appId,
                    terminalSubView: "edit",
                    editTerminalId: terminal.id,
                  });
                }}
                className="flex-1 cursor-pointer border-r border-[var(--glass-border)] py-2 text-center text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)] hover:bg-[var(--bg-glass-hover)]"
              >
                编辑
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(terminal);
                }}
                className="flex-1 cursor-pointer py-2 text-center text-xs font-medium text-red-500 transition-colors hover:text-red-400 hover:bg-red-500/5"
              >
                删除
              </button>
            </div>
          </div>
        ))}

        {/* Add card — dashed border, same size as terminal cards, centered content */}
        <button
          type="button"
          className="flex h-[89px] items-center justify-center rounded-xl border border-dashed border-[var(--glass-border)] text-[var(--text-quaternary)] transition-colors hover:border-[var(--glass-border-hover)] hover:text-[var(--text-tertiary)] hover:bg-[var(--bg-glass-hover)] cursor-pointer"
          onClick={() =>
            navigate("新建终端", {
              appId,
              terminalSubView: "create",
            })
          }
        >
          <div className="flex flex-col items-center gap-1.5">
            <Plus className="h-5 w-5" />
            <span className="text-xs">新建终端</span>
          </div>
        </button>
      </div>
    </div>
  );
}

// ── Create View ──

function TerminalCreateView({ appId }: { appId: string }) {
  const { goBack } = useWindowNav();

  const terminalsQuery = api.sshTerminal.list.useQuery(
    { appId },
    { enabled: false },
  );

  const createMutation = api.sshTerminal.create.useMutation({
    onSuccess: () => {
      terminalsQuery.refetch();
      goBack();
    },
  });

  const handleSubmit = useCallback(
    (data: CreateSshTerminalInput | UpdateSshTerminalInput) => {
      createMutation.mutate(data as CreateSshTerminalInput);
    },
    [createMutation],
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
          新建终端
        </h3>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-lg mx-auto">
          <SshTerminalForm
            appId={appId}
            terminal={null}
            onSubmit={handleSubmit}
            onCancel={goBack}
            isLoading={createMutation.isPending}
          />
        </div>
      </div>
    </div>
  );
}

// ── Edit View ──

function TerminalEditView({
  appId,
  terminalId,
}: {
  appId: string;
  terminalId: string;
}) {
  const { goBack } = useWindowNav();

  const terminalsQuery = api.sshTerminal.list.useQuery({ appId });
  const terminal =
    (terminalsQuery.data ?? []).find((t) => t.id === terminalId) ?? null;

  const updateMutation = api.sshTerminal.update.useMutation({
    onSuccess: () => {
      terminalsQuery.refetch();
      goBack();
    },
  });

  const handleSubmit = useCallback(
    (data: CreateSshTerminalInput | UpdateSshTerminalInput) => {
      updateMutation.mutate(data as UpdateSshTerminalInput);
    },
    [updateMutation],
  );

  if (terminalsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spin />
      </div>
    );
  }

  if (!terminal) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-[var(--text-tertiary)]">终端不存在</p>
        <Button onClick={goBack}>返回</Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
          编辑终端 — {terminal.name}
        </h3>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-lg mx-auto">
          <SshTerminalForm
            appId={appId}
            terminal={terminal}
            onSubmit={handleSubmit}
            onCancel={goBack}
            isLoading={updateMutation.isPending}
          />
        </div>
      </div>
    </div>
  );
}
