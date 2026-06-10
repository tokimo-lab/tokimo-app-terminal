/**
 * Terminal 管理页 — 左侧终端列表 + 右侧内联终端内容。
 *
 * 左侧边栏列出所有 SSH 终端，底部 "+" 新建（打开子弹窗）。
 * 点击条目在右侧打开 SshTerminalWindow（内联）。
 * 切换条目时右侧状态保留（组件保持挂载，visibility 切换）。
 * 选中项通过窗口路由持久化，已激活 session 持久化到窗口 metadata，刷新不丢失。
 */

import { useSidebarCollapsed, useWindowActions, useWindowNav } from "@tokimo/sdk";
import {
  AppSetupGuide,
  AppSidebar,
  type AppSidebarItem,
  type ContextMenuItem,
  Modal,
  Spin,
  Tooltip,
  useContextMenu,
} from "@tokimo/ui";
import {
  Container,
  Copy,
  Monitor,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import {
  type ComponentProps,
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppCtx } from "../AppContext";
import { terminalApi } from "../api/client";
import type { SshTerminalOutput } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { useContainerWidth } from "../hooks/use-container-width";
import { useMessage } from "../hooks/use-message";
import { useComponentPreference } from "../hooks/use-preference";
import { registerBridge } from "../modal-bridge";

const SshTerminalWindow = lazy(() => import("./SshTerminalWindow"));

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

export function TerminalApp() {
  const ctx = useAppCtx();
  const message = useMessage();
  const { route, replace } = useWindowNav();
  const { openModalWindow } = useWindowActions();
  const [containerRef, containerWidth] = useContainerWidth();
  const { collapsed: sidebarCollapsed, onToggleCollapse } = useSidebarCollapsed(
    "terminal",
    containerWidth > 0 && containerWidth < 720,
  );

  const { open: openCtxMenu, contextMenu } = useContextMenu();

  // Derive selection from window route
  const selection = useMemo(() => routeToSelection(route), [route]);
  const routeRef = useRef(route);
  routeRef.current = route;

  // Active terminal sessions persisted to app DB-backed preferences (the host's
  // minimal window DTO does not expose metadata, so window metadata is unused).
  const sessionsPref = useComponentPreference<{
    sessions?: Record<string, string>;
  }>("terminalSessions");
  const initialSessions = useRef<Map<string, string> | null>(null);
  if (initialSessions.current === null) {
    initialSessions.current = parseSessions(sessionsPref.data.sessions);
  }
  const [sessions, setSessionsRaw] = useState<Map<string, string>>(
    () => initialSessions.current ?? new Map(),
  );

  const setSessions = useCallback(
    (fn: (prev: Map<string, string>) => Map<string, string>) => {
      setSessionsRaw((prev) => {
        const next = fn(prev);
        void sessionsPref.patch({ sessions: Object.fromEntries(next) });
        return next;
      });
    },
    [sessionsPref],
  );

  // ── Data ──
  const terminalsQuery = useAsync(() => terminalApi.list(), []);

  // ── Handlers ──

  const handleSelect = useCallback(
    (terminalId: string) => {
      setSessions((prev) => {
        if (prev.has(terminalId)) return prev;
        const next = new Map(prev);
        next.set(terminalId, crypto.randomUUID());
        return next;
      });
      replace(`/${terminalId}`);
    },
    [replace, setSessions],
  );

  // ── Modal openers ──

  const openEditorModal = useCallback(
    (opts: { terminalId?: string; duplicateId?: string } = {}) => {
      const isEdit = !!opts.terminalId;
      const meta: Record<string, unknown> = {};
      const bridgeId = registerBridge({
        ctx,
        terminalId: opts.terminalId,
        duplicateId: opts.duplicateId,
        onSaved: (savedId, edited) => {
          terminalsQuery.reload();
          if (!edited) handleSelect(savedId);
        },
      });
      meta.bridgeId = bridgeId;
      openModalWindow({
        component: () => import("./SshTerminalEditorWindow"),
        title: isEdit ? "编辑终端" : "新建终端",
        width: 640,
        height: 620,
        metadata: meta,
      });
    },
    [openModalWindow, ctx, terminalsQuery, handleSelect],
  );

  const handleDelete = useCallback(
    (t: SshTerminalOutput) => {
      Modal.confirm({
        title: "删除终端",
        content: `确定要删除「${t.name}」吗？`,
        okText: "删除",
        variant: "danger",
        cancelText: "取消",
        onOk: async () => {
          setSessions((prev) => {
            const next = new Map(prev);
            next.delete(t.id);
            return next;
          });
          const cur = routeToSelection(routeRef.current);
          if (cur.kind === "terminal" && cur.terminalId === t.id) {
            replace("/");
          }
          await terminalApi.delete(t.id);
          terminalsQuery.reload();
          message.success("终端已删除");
        },
      });
    },
    [setSessions, replace, terminalsQuery, message],
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
  const isLoading = terminalsQuery.loading;

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

  if (!isLoading && terminals.length === 0) {
    // The host bundles its own lucide-react copy; casting the icon components
    // through the AppSetupGuide prop type bridges the duplicate-package
    // identity gap without `any`.
    type GuideProps = ComponentProps<typeof AppSetupGuide>;
    type GuideIcon = NonNullable<GuideProps["actionIcon"]>;
    const featureIcons = [Server, Monitor, Container] as unknown as GuideIcon[];
    return (
      <AppSetupGuide
        imageSrc="/api/apps/terminal/assets/icon.png"
        accentColor="violet"
        title="开始使用 Terminal"
        description="远程服务器，触手可及"
        features={[
          "SSH 连接远程服务器",
          "多终端标签页同时管理",
          "Docker 容器监控与操作",
        ].map((label, i) => ({
          icon: featureIcons[i],
          label,
        }))}
        actionLabel="新建终端"
        actionIcon={Plus as unknown as GuideIcon}
        onAction={() => openEditorModal()}
      />
    );
  }

  const collapsedFooter = (
    <div className="flex flex-col items-center gap-1">
      <Tooltip title="新建终端" placement="right">
        <button
          type="button"
          onClick={() => openEditorModal()}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
        >
          <Plus size={15} className="opacity-70" />
        </button>
      </Tooltip>
      <Tooltip title="展开侧边栏" placement="right">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
        >
          <PanelLeft size={15} className="opacity-70" />
        </button>
      </Tooltip>
    </div>
  );

  const fullFooter = (
    <div className="flex items-center">
      <button
        type="button"
        onClick={() => openEditorModal()}
        className="flex flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-fg-muted transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
      >
        <Plus size={14} className="shrink-0 opacity-60" />
        <span>新建终端</span>
      </button>
      <Tooltip title="收起侧边栏">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
        >
          <PanelLeftClose size={14} className="opacity-70" />
        </button>
      </Tooltip>
    </div>
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
          if (t) handleSelect(t.id);
        }}
        loading={isLoading}
        footer={sidebarCollapsed ? collapsedFooter : fullFooter}
      />

      {/* ── Right Content ── */}
      <div className="flex-1 min-w-0 relative bg-[var(--color-surface-content)]">
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
