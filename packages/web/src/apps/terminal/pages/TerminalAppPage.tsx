/**
 * Terminal 管理页 — 左侧终端列表 + 右侧内联终端内容。
 *
 * 左侧边栏列出所有 SSH 终端，底部 "+" 新建。
 * 点击条目在右侧打开 SshTerminalWindow（内联）。
 * 切换条目时右侧状态保留（组件保持挂载，visibility 切换）。
 * 选中项和所有已激活 session 持久化到窗口 metadata，刷新不丢失。
 */

import {
  type ContextMenuItem,
  Modal,
  Spin,
  useContextMenu,
  useToast,
} from "@tokiomo/components";
import { Monitor, Pencil, Plus, Trash2 } from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useMemo,
  useState,
} from "react";
import SshTerminalForm from "@/apps/terminal/components/SshTerminalForm";
import {
  api,
  type CreateSshTerminalInput,
  type SshTerminalOutput,
  type UpdateSshTerminalInput,
} from "@/generated/rust-api";
import { randomUUID } from "@/lib/uuid";
import { useWindowNav } from "@/system";

const SshTerminalWindow = lazy(
  () => import("@/apps/terminal/components/SshTerminalWindow"),
);

// ── Types ──

type Selection =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; terminalId: string }
  | { kind: "terminal"; terminalId: string };

function serializeSelection(s: Selection): string | undefined {
  if (s.kind === "none") return undefined;
  if (s.kind === "create") return "create";
  if (s.kind === "edit") return `edit:${s.terminalId}`;
  return s.terminalId;
}

function deserializeSelection(v: unknown): Selection {
  if (typeof v !== "string" || !v) return { kind: "none" };
  if (v === "create") return { kind: "create" };
  if (v.startsWith("edit:")) return { kind: "edit", terminalId: v.slice(5) };
  return { kind: "terminal", terminalId: v };
}

function parseSessions(v: unknown): Map<string, string> {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    return new Map(Object.entries(v as Record<string, string>));
  }
  return new Map();
}

// ── Page ──

export default function TerminalAppPage() {
  const toast = useToast();
  const { params, updateMetadata } = useWindowNav();
  const { open: openCtxMenu, contextMenu } = useContextMenu();

  // Restore from window metadata
  const [selection, setSelectionRaw] = useState<Selection>(() =>
    deserializeSelection(params.terminalSelection),
  );
  const [sessions, setSessionsRaw] = useState<Map<string, string>>(() =>
    parseSessions(params.terminalSessions),
  );

  // Persist-aware setters
  const setSelection = useCallback(
    (s: Selection) => {
      setSelectionRaw(s);
      updateMetadata({ terminalSelection: serializeSelection(s) });
    },
    [updateMetadata],
  );

  const setSessions = useCallback(
    (fn: (prev: Map<string, string>) => Map<string, string>) => {
      setSessionsRaw((prev) => {
        const next = fn(prev);
        updateMetadata({ terminalSessions: Object.fromEntries(next) });
        return next;
      });
    },
    [updateMetadata],
  );

  // ── Queries & mutations ──
  const terminalsQuery = api.sshTerminal.list.useQuery();

  const createMutation = api.sshTerminal.create.useMutation({
    onSuccess: () => {
      terminalsQuery.refetch();
      setSelection({ kind: "none" });
      toast.success("终端已创建");
    },
  });

  const updateMutation = api.sshTerminal.update.useMutation({
    onSuccess: () => {
      terminalsQuery.refetch();
      setSelection({ kind: "none" });
      toast.success("终端已更新");
    },
  });

  const deleteMutation = api.sshTerminal.delete.useMutation({
    onSuccess: () => {
      terminalsQuery.refetch();
      toast.success("终端已删除");
    },
  });

  // ── Handlers ──

  const handleSelect = useCallback(
    (t: SshTerminalOutput) => {
      setSessions((prev) => {
        if (prev.has(t.id)) return prev;
        const next = new Map(prev);
        next.set(t.id, randomUUID());
        return next;
      });
      setSelection({ kind: "terminal", terminalId: t.id });
    },
    [setSelection, setSessions],
  );

  const handleDelete = useCallback(
    (t: SshTerminalOutput) => {
      Modal.confirm({
        title: "删除终端",
        content: `确定要删除「${t.name}」吗？`,
        okText: "删除",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: () => {
          setSessions((prev) => {
            const next = new Map(prev);
            next.delete(t.id);
            return next;
          });
          setSelectionRaw((prev) => {
            if (prev.kind === "terminal" && prev.terminalId === t.id) {
              updateMetadata({ terminalSelection: undefined });
              return { kind: "none" };
            }
            return prev;
          });
          return deleteMutation.mutateAsync(t.id);
        },
      });
    },
    [deleteMutation, setSessions, updateMetadata],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, t: SshTerminalOutput) => {
      const items: ContextMenuItem[] = [
        {
          key: "edit",
          label: "编辑",
          icon: <Pencil size={13} />,
          onClick: () => setSelection({ kind: "edit", terminalId: t.id }),
        },
        { type: "divider" },
        {
          key: "delete",
          label: "删除",
          icon: <Trash2 size={13} />,
          danger: true,
          onClick: () => handleDelete(t),
        },
      ];
      openCtxMenu(e, items);
    },
    [openCtxMenu, setSelection, handleDelete],
  );

  const terminals = terminalsQuery.data ?? [];

  const activatedTerminals = useMemo(() => [...sessions.entries()], [sessions]);

  return (
    <div className="flex h-full">
      {/* ── Left Sidebar ── */}
      <div className="w-56 flex-shrink-0 border-r border-border-base flex flex-col overflow-hidden bg-[var(--sidebar-bg)]">
        {terminalsQuery.isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Spin />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto select-none py-1">
            {terminals.map((t) => (
              <SidebarItem
                key={t.id}
                label={t.name}
                subtitle={`${t.username}@${t.host}:${t.port}`}
                active={
                  (selection.kind === "terminal" &&
                    selection.terminalId === t.id) ||
                  (selection.kind === "edit" && selection.terminalId === t.id)
                }
                onClick={() => handleSelect(t)}
                onContextMenu={(e) => handleContextMenu(e, t)}
              />
            ))}
          </div>
        )}

        {/* Bottom add button */}
        <div className="border-t border-border-base p-2">
          <button
            type="button"
            className="w-full flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-colors cursor-pointer"
            onClick={() => setSelection({ kind: "create" })}
          >
            <Plus className="h-3.5 w-3.5" />
            新建终端
          </button>
        </div>
      </div>

      {/* ── Right Content ── */}
      <div className="flex-1 min-w-0 relative">
        {/* Empty state */}
        {selection.kind === "none" && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-quaternary)] gap-2">
            <Monitor className="h-8 w-8" />
            <span className="text-sm">选择终端或新建一个</span>
          </div>
        )}

        {/* Create form */}
        {selection.kind === "create" && (
          <FormPanel
            title="新建终端"
            onBack={() => setSelection({ kind: "none" })}
          >
            <SshTerminalForm
              terminal={null}
              onSubmit={(data) =>
                createMutation.mutate(data as CreateSshTerminalInput)
              }
              onCancel={() => setSelection({ kind: "none" })}
              isLoading={createMutation.isPending}
            />
          </FormPanel>
        )}

        {/* Edit form */}
        {selection.kind === "edit" && (
          <EditPanel
            terminalId={selection.terminalId}
            terminals={terminals}
            onBack={() => setSelection({ kind: "none" })}
            onSubmit={(data) =>
              updateMutation.mutate(data as UpdateSshTerminalInput)
            }
            isLoading={updateMutation.isPending}
          />
        )}

        {/* Active terminals — all mounted, visibility toggled */}
        {activatedTerminals.map(([terminalId, sessionId]) => {
          const t = terminals.find((x) => x.id === terminalId);
          const label = t ? `${t.username}@${t.host}` : undefined;
          return (
            <div
              key={terminalId}
              className={
                selection.kind === "terminal" &&
                selection.terminalId === terminalId
                  ? "h-full"
                  : "hidden"
              }
            >
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <Spin />
                  </div>
                }
              >
                <SshTerminalWindow
                  terminalId={terminalId}
                  initialSessionId={sessionId}
                  connectionLabel={label}
                />
              </Suspense>
            </div>
          );
        })}
      </div>

      {contextMenu}
    </div>
  );
}

// ── Sub-components ──

function SidebarItem({
  label,
  subtitle,
  active,
  onClick,
  onContextMenu,
}: {
  label: string;
  subtitle: string;
  active: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors cursor-pointer group/item ${
        active
          ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-glass-hover)]"
      }`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <Monitor className="h-3.5 w-3.5 shrink-0 text-violet-500" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{label}</div>
        <p className="text-[10px] text-[var(--text-quaternary)] truncate">
          {subtitle}
        </p>
      </div>
    </button>
  );
}

function FormPanel({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)] cursor-pointer"
        >
          ←
        </button>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {title}
        </h3>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div className="max-w-lg mx-auto">{children}</div>
      </div>
    </div>
  );
}

function EditPanel({
  terminalId,
  terminals,
  onBack,
  onSubmit,
  isLoading,
}: {
  terminalId: string;
  terminals: SshTerminalOutput[];
  onBack: () => void;
  onSubmit: (data: CreateSshTerminalInput | UpdateSshTerminalInput) => void;
  isLoading: boolean;
}) {
  const terminal = terminals.find((t) => t.id === terminalId) ?? null;
  if (!terminal) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-[var(--text-tertiary)]">终端不存在</p>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-[var(--accent)] hover:underline cursor-pointer"
        >
          返回
        </button>
      </div>
    );
  }
  return (
    <FormPanel title={`编辑 — ${terminal.name}`} onBack={onBack}>
      <SshTerminalForm
        terminal={terminal}
        onSubmit={onSubmit}
        onCancel={onBack}
        isLoading={isLoading}
      />
    </FormPanel>
  );
}
