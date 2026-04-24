/**
 * Terminal 管理页 — 左侧终端列表 + 右侧内联终端内容。
 *
 * 左侧边栏列出所有 SSH 终端，底部 "+" 新建（打开子弹窗）。
 * 点击条目在右侧打开 SshTerminalWindow（内联）。
 * 切换条目时右侧状态保留（组件保持挂载，visibility 切换）。
 * 选中项通过窗口路由持久化，已激活 session 持久化到窗口 metadata，刷新不丢失。
 *
 * 新建 / 编辑使用子弹窗（modal window），与 video app 模式一致。
 */

import {
  AppSidebar,
  type AppSidebarItem,
  type ContextMenuItem,
  Modal,
  Spin,
  useContextMenu,
} from "@tokimo/ui";
import { Copy, Monitor, Pencil, Plus, Trash2 } from "lucide-react";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { api, type SshTerminalOutput } from "@/generated/rust-api";
import { randomUUID } from "@/lib/uuid";
import { useContainerWidth } from "@/shared/hooks/use-container-width";
import { useWindowActions, useWindowId, useWindowNav } from "@/system";
import { useMessage } from "@/system/notifications/useMessage";
import type { TaskMetadata } from "@/system/window/window-types";

const SshTerminalWindow = lazy(
  () => import("@/apps/terminal/components/SshTerminalWindow"),
);

// ── Types ──

type Selection = { kind: "none" } | { kind: "terminal"; terminalId: string };

function routeToSelection(route: string): Selection {
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
  const message = useMessage();
  const { metadata, updateMetadata, route, replace } = useWindowNav();
  const [containerRef, containerWidth] = useContainerWidth();
  const sidebarCollapsed = containerWidth > 0 && containerWidth < 720;
  const { open: openCtxMenu, contextMenu } = useContextMenu();

  const windowId = useWindowId();
  const { openModalWindow } = useWindowActions();

  // Derive selection from window route
  const selection = useMemo(() => routeToSelection(route), [route]);
  const routeRef = useRef(route);
  routeRef.current = route;

  const [sessions, setSessionsRaw] = useState<Map<string, string>>(() =>
    parseSessions(metadata.terminalSessions),
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

  const deleteMutation = api.sshTerminal.delete.useMutation({
    onSuccess: () => {
      terminalsQuery.refetch();
      message.success("终端已删除");
    },
  });

  // ── Modal openers ──

  const openEditorModal = useCallback(
    (opts: { terminalId?: string; duplicateId?: string } = {}) => {
      const meta: Record<string, unknown> = {};
      if (opts.terminalId) meta.sshTerminalId = opts.terminalId;
      if (opts.duplicateId) meta.sshTerminalDuplicateId = opts.duplicateId;
      openModalWindow({
        component: () =>
          import("@/apps/settings/admin/SshTerminalEditorWindow"),
        parentWindowId: windowId,
        title: opts.terminalId ? "编辑终端" : "新建终端",
        width: 640,
        height: 620,
        noResize: true,
        noMinimize: true,
        metadata:
          Object.keys(meta).length > 0
            ? (meta as Record<string, unknown> as TaskMetadata)
            : undefined,
      });
    },
    [openModalWindow, windowId],
  );

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
          if (cur.kind === "terminal" && cur.terminalId === t.id) {
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
          onClick: () => openEditorModal({ terminalId: t.id }),
        },
        {
          key: "duplicate",
          label: "复制",
          icon: <Copy size={13} />,
          onClick: () => openEditorModal({ duplicateId: t.id }),
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
    [openCtxMenu, openEditorModal, handleDelete],
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
    <div ref={containerRef} className="relative flex h-full">
      {/* ── Left Sidebar ── */}
      <AppSidebar
        width={224}
        collapsed={sidebarCollapsed}
        sections={[{ items: sidebarItems }]}
        activeKey={
          selection.kind === "terminal" ? selection.terminalId : undefined
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
            onClick={() => openEditorModal()}
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
