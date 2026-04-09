/**
 * Terminal 管理页 — 左侧终端列表 + 右侧内联终端内容。
 *
 * 左侧边栏列出所有 SSH 终端，底部 "+" 新建。
 * 点击条目在右侧打开 SshTerminalWindow（内联）。
 * 切换条目时右侧状态保留（组件保持挂载，visibility 切换）。
 * 选中项通过窗口路由持久化，已激活 session 持久化到窗口 metadata，刷新不丢失。
 */

import {
  AppSidebar,
  type AppSidebarItem,
  type ContextMenuItem,
  Modal,
  Spin,
  useContextMenu,
  useToast,
} from "@tokiomo/components";
import { Copy, Monitor, Pencil, Plus, Trash2 } from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useMemo,
  useRef,
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
import { useContainerWidth } from "@/shared/hooks/use-container-width";
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

function routeToSelection(route: string): Selection {
  if (route === "/new") return { kind: "create" };
  const editMatch = route.match(/^\/([^/]+)\/edit$/);
  if (editMatch) return { kind: "edit", terminalId: editMatch[1] };
  const idMatch = route.match(/^\/([^/]+)$/);
  if (idMatch) return { kind: "terminal", terminalId: idMatch[1] };
  return { kind: "none" };
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
  const { metadata, updateMetadata, route, replace, navigate, goBack } =
    useWindowNav();
  const [containerRef, containerWidth] = useContainerWidth();
  const sidebarCollapsed = containerWidth > 0 && containerWidth < 720;
  const { open: openCtxMenu, contextMenu } = useContextMenu();

  // Derive selection from window route
  const selection = useMemo(() => routeToSelection(route), [route]);
  const routeRef = useRef(route);
  routeRef.current = route;

  const [sessions, setSessionsRaw] = useState<Map<string, string>>(() =>
    parseSessions(metadata.terminalSessions),
  );

  const [duplicateFrom, setDuplicateFrom] = useState<SshTerminalOutput | null>(
    null,
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
      setDuplicateFrom(null);
      replace("/");
      toast.success("终端已创建");
    },
  });

  const updateMutation = api.sshTerminal.update.useMutation({
    onSuccess: () => {
      terminalsQuery.refetch();
      replace("/");
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
      replace(`/${t.id}`);
    },
    [replace, setSessions],
  );

  const handleDelete = useCallback(
    (t: SshTerminalOutput) => {
      Modal.confirm({
        title: "删除终端",
        content: `确定要删除「${t.name}」吗？`,
        okText: "删除",
        variant: "danger",
        cancelText: "取消",
        onOk: () => {
          setSessions((prev) => {
            const next = new Map(prev);
            next.delete(t.id);
            return next;
          });
          const cur = routeToSelection(routeRef.current);
          if (
            (cur.kind === "terminal" || cur.kind === "edit") &&
            cur.terminalId === t.id
          ) {
            replace("/");
          }
          return deleteMutation.mutateAsync(t.id);
        },
      });
    },
    [deleteMutation, setSessions, replace],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, t: SshTerminalOutput) => {
      const items: ContextMenuItem[] = [
        {
          key: "edit",
          label: "编辑",
          icon: <Pencil size={13} />,
          onClick: () => navigate(`/${t.id}/edit`),
        },
        {
          key: "duplicate",
          label: "复制",
          icon: <Copy size={13} />,
          onClick: () => {
            setDuplicateFrom(t);
            navigate("/new");
          },
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
    [openCtxMenu, navigate, handleDelete],
  );

  const terminals = terminalsQuery.data ?? [];

  const activatedTerminals = useMemo(() => [...sessions.entries()], [sessions]);

  const sidebarItems: AppSidebarItem[] = useMemo(
    () =>
      terminals.map((t) => ({
        key: t.id,
        icon: <Monitor className="h-3.5 w-3.5 text-violet-500" />,
        label: t.name,
        subtitle: `${t.username}@${t.host}:${t.port}`,
        onContextMenu: (e: React.MouseEvent) => handleContextMenu(e, t),
      })),
    [terminals, handleContextMenu],
  );

  return (
    <div ref={containerRef} className="flex h-full">
      {/* ── Left Sidebar ── */}
      <AppSidebar
        width={224}
        collapsed={sidebarCollapsed}
        sections={[{ items: sidebarItems }]}
        activeKey={
          selection.kind === "terminal" || selection.kind === "edit"
            ? selection.terminalId
            : undefined
        }
        onSelect={(key) => {
          const t = terminals.find((x) => x.id === key);
          if (t) handleSelect(t);
        }}
        loading={terminalsQuery.isLoading}
        footer={
          <button
            type="button"
            className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]"
            onClick={() => navigate("/new")}
          >
            <Plus className="h-3.5 w-3.5" />
            新建终端
          </button>
        }
      />

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
            onBack={() => {
              setDuplicateFrom(null);
              goBack();
            }}
          >
            <SshTerminalForm
              terminal={null}
              defaultValues={
                duplicateFrom
                  ? {
                      name: `${duplicateFrom.name} 副本`,
                      host: duplicateFrom.host,
                      port: duplicateFrom.port,
                      username: duplicateFrom.username,
                      authMethod: duplicateFrom.authMethod,
                      startupCommand: duplicateFrom.startupCommand,
                      notes: duplicateFrom.notes,
                    }
                  : undefined
              }
              onSubmit={(data) =>
                createMutation.mutate(data as CreateSshTerminalInput)
              }
              onCancel={() => {
                setDuplicateFrom(null);
                goBack();
              }}
              isLoading={createMutation.isPending}
            />
          </FormPanel>
        )}

        {/* Edit form */}
        {selection.kind === "edit" && (
          <EditPanel
            terminalId={selection.terminalId}
            terminals={terminals}
            onBack={goBack}
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
