/**
 * Remote file browser panel for SSH terminal.
 * Lists files via the /api/apps/terminal/connections/{id}/ls endpoint.
 * Reuses the visual components from the app FileManager
 * (FileGrid, FileBreadcrumb, FileToolbar).
 *
 * Supports: navigate, new folder, rename, delete, download,
 * double-click to open text files (with SSH-backed read/write).
 */
import {
  type ContextMenuItem,
  FileBreadcrumb,
  FileColumnView,
  FileGrid,
  type FileNode,
  FileToolbar,
  Modal,
  type SortBy,
  type SortDir,
  Spin,
  sortNodes,
  useContextMenu,
  useInlineRename,
  type ViewMode,
} from "@tokimo/ui";
import {
  CheckCircle,
  Download,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NewFolderModal } from "@/apps/finder/components/FileModals";
import {
  buildDragPayload,
  buildTransferRequest,
  hasDragPayload,
  isCrossStorageDrop,
  readDragPayload,
  writeDragPayload,
} from "@/apps/transfer/components/drag-drop";
import { useTransfer } from "@/apps/transfer/components/use-transfer";
import { buildSshFileUrl, getFileWindowType } from "@/apps/viewers/file-url";
import { api, type RustApiError } from "@/generated/rust-api";
import type { SshFileEntry } from "@/generated/rust-types/SshFileEntry";
import { useComponentPreference } from "@/shared/hooks/use-preference";
import { useWindowActions } from "@/system";
import { useMessage } from "@/system/notifications/useMessage";
import { formatBytes } from "./ssh-terminal-utils";

// ── Upload queue types ────────────────────────────────────────────────────────

export type UploadStatus = "pending" | "uploading" | "done" | "error";

export interface UploadItem {
  id: string;
  filename: string;
  size: number;
  loaded: number;
  status: UploadStatus;
  error?: string;
}

export type UploadQueue = UploadItem[];

export interface SshFileTreeProps {
  terminalId: string;
  connected: boolean;
  /** Upload queue driven from outside (lifted up to SshTerminalWindow). */
  uploadQueue: UploadQueue;
  onUploadFiles: (targetDir: string, files: File[]) => void;
  /** Called whenever the user navigates to a new directory. */
  onPathChange?: (path: string) => void;
  /** Label shown next to the SSH badge, e.g. "root@10.0.0.1" */
  connectionLabel?: string;
  /** Initial directory path to show on mount (restored from persisted state). */
  initialPath?: string;
}

/** Convert SSH ls entries into FileNode[] that FileGrid understands. */
function toFileNodes(entries: SshFileEntry[], basePath: string): FileNode[] {
  return entries.map((e) => {
    const fullPath = basePath === "/" ? `/${e.name}` : `${basePath}/${e.name}`;
    // NOTE: SSH mode is string (octal), but FileNode expects number.
    // Cast to number via parseInt for compatibility, or null if not parseable.
    const mode = e.mode ? Number.parseInt(e.mode, 8) : null;
    return {
      name: e.name,
      path: fullPath,
      isDirectory: e.isDir,
      size: e.size || null,
      modifiedAt: e.modifiedAt ?? null,
      mode,
    } as FileNode; // NOTE: owner field not in ui FileNode, but kept in local state
  });
}

/** Join parent path and child name. */
function joinPath(parent: string, name: string): string {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

/** Get parent directory of a path. */
function getParentPath(p: string): string {
  return p.replace(/\/[^/]+$/, "") || "/";
}

/** Build the download URL for an SSH file. */
function buildDownloadUrl(terminalId: string, filePath: string): string {
  return buildSshFileUrl(terminalId, filePath) ?? "";
}

export default function SshFileTree({
  terminalId,
  connected,
  uploadQueue,
  onUploadFiles,
  onPathChange,
  connectionLabel,
  initialPath,
}: SshFileTreeProps) {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState(initialPath || "/");
  const [rawNodes, setRawNodes] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [pathNotFound, setPathNotFound] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Drag-and-drop state
  const [draggingPaths, setDraggingPaths] = useState<Set<string>>(new Set());
  const [isDragOver, setIsDragOver] = useState(false);
  const dragEnterCount = useRef(0);
  const isInternalDragRef = useRef(false);
  const [subColumnRefreshKey, setSubColumnRefreshKey] = useState(0);
  const bumpSubColumnRefresh = useCallback(
    () => setSubColumnRefreshKey((k) => k + 1),
    [],
  );

  // Hidden file input ref for upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string>("/");

  // Read initial viewMode from user preferences
  const terminalPref = useComponentPreference("terminal");
  const savedViewMode = (
    terminalPref.data?.fileBrowser as Record<string, unknown> | undefined
  )?.viewMode;

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>(
    savedViewMode === "grid" ||
      savedViewMode === "list" ||
      savedViewMode === "column"
      ? (savedViewMode as ViewMode)
      : "list",
  );
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showHidden, setShowHidden] = useState(false);
  const [columnLeafPath, setColumnLeafPath] = useState<string | null>(null);

  // Modals
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Window manager for opening files in Monaco editor
  const windowManager = useWindowActions();
  const { transfers, createTransfer } = useTransfer();

  // ─── Auto-refresh when an incoming transfer completes ───
  const pendingTransferIds = useRef(new Set<string>());
  const completedTransferIds = useRef(new Set<string>());

  const message = useMessage();

  // Context menu
  const { open: openCtxMenu, contextMenu } = useContextMenu();
  const ctxTarget = useRef<FileNode | null>(null);

  const fetchDir = useCallback(
    async (path: string) => {
      const resp = await api.sshTerminal.ls.fetch({
        id: terminalId,
        path,
      });
      return resp.entries;
    },
    [terminalId],
  );

  const refresh = useCallback(() => {
    setLoading(true);
    fetchDir(currentPath)
      .then((result) => {
        setPathNotFound(false);
        setRawNodes(toFileNodes(result, currentPath));
        setSelectedPaths(new Set());
      })
      .catch((err: RustApiError) => {
        if (err.status === 404) {
          setPathNotFound(true);
          setRawNodes([]);
        }
      })
      .finally(() => setLoading(false));
  }, [currentPath, fetchDir]);

  const mvMut = api.sshTerminal.mv.useMutation({
    onSuccess: () => {
      refresh();
      bumpSubColumnRefresh();
    },
  });

  // Auto-refresh when uploads finish
  const refreshedUploadIds = useRef(new Set<string>());
  useEffect(() => {
    const newlyDone = uploadQueue.filter(
      (u) => u.status === "done" && !refreshedUploadIds.current.has(u.id),
    );
    if (newlyDone.length > 0) {
      for (const item of newlyDone) {
        refreshedUploadIds.current.add(item.id);
      }
      refresh();
    }
  }, [uploadQueue, refresh]);

  // Auto-refresh when an incoming transfer completes
  useEffect(() => {
    for (const tid of pendingTransferIds.current) {
      const snap = transfers.get(tid);
      if (
        snap?.status === "completed" &&
        !completedTransferIds.current.has(tid)
      ) {
        completedTransferIds.current.add(tid);
        refresh();
      }
    }
  }, [transfers, refresh]);

  // Fetch directory on connect / path change
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    setLoading(true);
    fetchDir(currentPath)
      .then((result) => {
        if (!cancelled) {
          setPathNotFound(false);
          setRawNodes(toFileNodes(result, currentPath));
          setSelectedPaths(new Set());
        }
      })
      .catch((err: RustApiError) => {
        if (!cancelled && err.status === 404) {
          setPathNotFound(true);
          setRawNodes([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentPath, connected, fetchDir]);

  const nodes = useMemo(() => {
    const filtered = showHidden
      ? rawNodes
      : rawNodes.filter((n) => !n.name.startsWith("."));
    return sortNodes(filtered, sortBy, sortDir);
  }, [rawNodes, showHidden, sortBy, sortDir]);

  const effectivePath =
    viewMode === "column" && columnLeafPath ? columnLeafPath : currentPath;

  useEffect(() => {
    onPathChange?.(effectivePath);
  }, [effectivePath, onPathChange]);

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
  }, []);

  // SSH directory fetcher for column view sub-columns
  const fetchSshDirectory = useCallback(
    async (dirPath: string): Promise<FileNode[]> => {
      const resp = await api.sshTerminal.ls.fetch({
        id: terminalId,
        path: dirPath,
      });
      return toFileNodes(resp.entries, dirPath);
    },
    [terminalId],
  );

  // ── Actions ──

  const handleMkdir = useCallback(
    async (name: string) => {
      const dirPath = joinPath(currentPath, name);
      await api.sshTerminal.mkdir.mutate({ id: terminalId, path: dirPath });
      setShowNewFolder(false);
      refresh();
    },
    [terminalId, currentPath, refresh],
  );

  const handleRename = useCallback(
    async (oldPath: string, newName: string) => {
      const parent = getParentPath(oldPath);
      const to = joinPath(parent, newName);
      await api.sshTerminal.rename.mutate({
        id: terminalId,
        from: oldPath,
        to,
      });
    },
    [terminalId],
  );

  const inlineRename = useInlineRename({
    renameFn: handleRename,
    onSuccess: refresh,
  });

  const handleDelete = useCallback(async () => {
    for (const path of selectedPaths) {
      await api.sshTerminal.rm.mutate({ id: terminalId, path });
    }
    setDeleteConfirm(false);
    setSelectedPaths(new Set());
    refresh();
  }, [terminalId, selectedPaths, refresh]);

  // ── Drag-and-drop handlers ──

  const handleDragStart = useCallback(
    (node: FileNode, contextNodes: FileNode[], e: React.DragEvent) => {
      let paths: Set<string>;
      if (!selectedPaths.has(node.path)) {
        setSelectedPaths(new Set([node.path]));
        paths = new Set([node.path]);
      } else {
        paths = new Set(selectedPaths);
      }
      setDraggingPaths(paths);
      isInternalDragRef.current = true;

      // Write cross-storage drag payload — prefer contextNodes (the actual
      // view container the user is dragging from) over the global node list.
      const source = contextNodes.length > 0 ? contextNodes : nodes;
      const dragNodes = source.filter((n) => paths.has(n.path));
      const payload = buildDragPayload(
        "ssh-terminal",
        terminalId,
        connectionLabel ?? terminalId,
        dragNodes.length > 0 ? dragNodes : [node],
      );
      writeDragPayload(e, payload);
    },
    [selectedPaths, nodes, terminalId, connectionLabel],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingPaths(new Set());
    isInternalDragRef.current = false;
  }, []);

  /**
   * Unified drop handler — `targetDir` is the absolute remote directory.
   * Used by folder items, sub-column blank areas, and the root container.
   * Reads the source from the drag payload (works across windows / sub-columns).
   */
  const handleDropToPath = useCallback(
    (targetDir: string, e: React.DragEvent) => {
      isInternalDragRef.current = false;
      setIsDragOver(false);
      dragEnterCount.current = 0;
      const payload = readDragPayload(e);
      if (!payload) return;

      // Cross-storage transfer
      if (isCrossStorageDrop(payload, "ssh-terminal", terminalId)) {
        const req = buildTransferRequest(
          payload,
          "ssh-terminal",
          terminalId,
          connectionLabel ?? terminalId,
          targetDir,
        );
        createTransfer(req)
          .then((transferId) => {
            pendingTransferIds.current.add(transferId);
            windowManager.openWindow({
              type: "transfer",
              title: t("transfer.title"),
              route: `/transfers/${transferId}`,
              metadata: { transferId },
            });
          })
          .catch((err: Error) => message.error(err.message));
        setDraggingPaths(new Set());
        return;
      }

      // Same-terminal move (read source paths from payload, supports cross-window drag)
      for (const f of payload.files) {
        const parent = getParentPath(f.path);
        if (parent === targetDir) continue;
        if (
          f.isDirectory &&
          (f.path === targetDir || targetDir.startsWith(`${f.path}/`))
        ) {
          continue;
        }
        mvMut.mutate({ id: terminalId, from: f.path, toDir: targetDir });
      }
      setDraggingPaths(new Set());
    },
    [
      terminalId,
      mvMut,
      connectionLabel,
      createTransfer,
      windowManager,
      t,
      message,
    ],
  );

  const handleDropToFolder = useCallback(
    (targetNode: FileNode, e: React.DragEvent) => {
      if (!targetNode.isDirectory) return;
      handleDropToPath(targetNode.path, e);
    },
    [handleDropToPath],
  );

  const handleDownload = useCallback(
    (node: FileNode) => {
      const a = document.createElement("a");
      a.href = buildDownloadUrl(terminalId, node.path);
      a.download = node.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    [terminalId],
  );

  const handleOpenFile = useCallback(
    (node: FileNode) => {
      if (node.isDirectory) {
        navigateTo(node.path);
        return;
      }
      // Open file in a WindowManager window; route binary types to the right viewer
      const fileType = getFileWindowType(node.name);
      windowManager.openWindow({
        type: fileType,
        title: node.name,
        route: node.path,
        metadata: {
          filePath: node.path,
          fileName: node.name,
          sshTerminalId: terminalId,
        },
      });
    },
    [terminalId, navigateTo, windowManager],
  );

  // ── Selection ──

  const handleItemClick = useCallback((node: FileNode, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(node.path)) next.delete(node.path);
        else next.add(node.path);
        return next;
      });
    } else {
      setSelectedPaths(new Set([node.path]));
    }
  }, []);

  const handleItemDoubleClick = useCallback(
    (node: FileNode) => handleOpenFile(node),
    [handleOpenFile],
  );

  const clearSelection = useCallback(() => setSelectedPaths(new Set()), []);

  // ── Context menu ──

  const handleItemContextMenu = useCallback(
    (node: FileNode, e: React.MouseEvent) => {
      e.preventDefault();
      ctxTarget.current = node;
      if (!selectedPaths.has(node.path)) {
        setSelectedPaths(new Set([node.path]));
      }
      const multi = selectedPaths.has(node.path) ? selectedPaths.size : 1;
      const items: ContextMenuItem[] = [];

      if (node.isDirectory) {
        items.push({
          key: "open",
          label: t("fileManager.ctx.open"),
          icon: <FolderOpen size={13} />,
          onClick: () => navigateTo(node.path),
        });
      } else {
        items.push({
          key: "open",
          label: t("fileManager.ctx.open"),
          icon: <FilePlus size={13} />,
          onClick: () => handleOpenFile(node),
        });
      }

      items.push(
        { key: "d1", type: "divider" },
        {
          key: "rename",
          label: t("fileManager.ctx.rename"),
          icon: <Pencil size={13} />,
          onClick: () => inlineRename.startRename(node.path),
          disabled: multi > 1,
        },
        {
          key: "download",
          label: t("common.download", "下载"),
          icon: <Download size={13} />,
          onClick: () => handleDownload(node),
          disabled: node.isDirectory,
        },
        { key: "d2", type: "divider" },
        {
          key: "delete",
          label:
            multi > 1
              ? `${t("fileManager.delete")} (${multi})`
              : t("fileManager.delete"),
          icon: <Trash2 size={13} />,
          danger: true,
          onClick: () => setDeleteConfirm(true),
        },
      );

      openCtxMenu(e, items);
    },
    [
      selectedPaths,
      navigateTo,
      handleOpenFile,
      handleDownload,
      openCtxMenu,
      t,
      inlineRename,
    ],
  );

  const triggerUpload = useCallback((targetDir: string) => {
    uploadTargetRef.current = targetDir;
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      onUploadFiles(uploadTargetRef.current, files);
      // reset so the same file can be re-selected
      e.target.value = "";
    },
    [onUploadFiles],
  );

  const handleEmptyContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setSelectedPaths(new Set());
      const items: ContextMenuItem[] = [
        {
          key: "new-folder",
          label: t("fileManager.newFolder"),
          icon: <FolderPlus size={13} />,
          onClick: () => setShowNewFolder(true),
        },
        {
          key: "upload",
          label: "上传文件",
          icon: <Upload size={13} />,
          onClick: () => triggerUpload(currentPath),
          disabled: !connected,
        },
        { key: "d1", type: "divider" },
        {
          key: "refresh",
          label: t("pathSelector.refresh"),
          icon: <RefreshCw size={13} />,
          onClick: refresh,
        },
      ];
      openCtxMenu(e, items);
    },
    [openCtxMenu, refresh, t, triggerUpload, currentPath, connected],
  );

  // ── Cross-storage container drop (into current directory) ──

  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    if (isInternalDragRef.current) return;
    if (hasDragPayload(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleContainerDragEnter = useCallback((e: React.DragEvent) => {
    if (isInternalDragRef.current) return;
    dragEnterCount.current++;
    if (hasDragPayload(e)) {
      e.preventDefault();
      setIsDragOver(true);
    }
  }, []);

  const handleContainerDragLeave = useCallback(() => {
    dragEnterCount.current--;
    if (dragEnterCount.current <= 0) {
      dragEnterCount.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleContainerDrop = useCallback(
    (e: React.DragEvent) => {
      dragEnterCount.current = 0;
      setIsDragOver(false);
      // In column mode, route to the deepest visible path (set by FileColumnView).
      const targetDir =
        viewMode === "column" && columnLeafPath ? columnLeafPath : currentPath;
      e.preventDefault();
      handleDropToPath(targetDir, e);
    },
    [viewMode, columnLeafPath, currentPath, handleDropToPath],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: cross-storage drop target
    <div
      className={[
        "flex flex-col h-full",
        isDragOver
          ? "outline-2 outline-dashed outline-blue-400/60 -outline-offset-2 bg-blue-500/5"
          : "",
      ].join(" ")}
      onDragOver={handleContainerDragOver}
      onDragEnter={handleContainerDragEnter}
      onDragLeave={handleContainerDragLeave}
      onDrop={handleContainerDrop}
    >
      {/* Breadcrumb */}
      <div className="border-b border-black/[0.06] dark:border-white/[0.08] shrink-0">
        <FileBreadcrumb
          currentPath={effectivePath}
          onNavigate={navigateTo}
          sourceType="ssh"
          sourceLabel={connectionLabel}
        />
      </div>

      {/* Toolbar */}
      <FileToolbar
        viewMode={viewMode}
        sortBy={sortBy}
        sortDir={sortDir}
        showHidden={showHidden}
        isFetching={loading}
        onNewFolder={() => setShowNewFolder(true)}
        onSetViewMode={(mode) => {
          if (viewMode === "column" && mode !== "column") {
            const target = columnLeafPath ?? currentPath;
            if (target !== currentPath) navigateTo(target);
          }
          setViewMode(mode);
        }}
        onSetSortBy={setSortBy}
        onSetSortDir={setSortDir}
        onSetShowHidden={setShowHidden}
        onRefresh={refresh}
      />

      {/* File grid / list / column */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Spin size="small" />
          </div>
        ) : pathNotFound ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 select-none text-sm text-[var(--text-quaternary)]">
            <FolderOpen size={32} strokeWidth={1.5} />
            <span>{t("fileManager.pathNotFound")}</span>
          </div>
        ) : viewMode === "column" ? (
          <FileColumnView
            currentPath={currentPath}
            nodes={nodes}
            selectedPaths={selectedPaths}
            renaming={inlineRename.renaming}
            sortBy={sortBy}
            sortDir={sortDir}
            showHidden={showHidden}
            fetchDirectory={fetchSshDirectory}
            acceptsExternalDrop={(e) => hasDragPayload(e)}
            onExternalDropToDir={handleDropToPath}
            onNavigate={navigateTo}
            onLeafPathChange={setColumnLeafPath}
            onItemClick={handleItemClick}
            onItemDoubleClick={handleItemDoubleClick}
            onItemContextMenu={handleItemContextMenu}
            onEmptyContextMenu={handleEmptyContextMenu}
            onRenameSubmit={inlineRename.handleSubmit}
            onRenameCancel={inlineRename.handleCancel}
            onClearSelection={clearSelection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDropToFolder={handleDropToFolder}
            onDropToDir={handleDropToPath}
            draggingPaths={draggingPaths}
            refreshKey={subColumnRefreshKey}
          />
        ) : (
          <FileGrid
            nodes={nodes}
            selectedPaths={selectedPaths}
            viewMode={viewMode}
            renaming={inlineRename.renaming}
            currentPath={currentPath}
            onNavigateUp={
              currentPath !== "/"
                ? () => navigateTo(getParentPath(currentPath))
                : undefined
            }
            onItemClick={handleItemClick}
            onItemDoubleClick={handleItemDoubleClick}
            onItemContextMenu={handleItemContextMenu}
            onEmptyContextMenu={handleEmptyContextMenu}
            onRenameSubmit={inlineRename.handleSubmit}
            onRenameCancel={inlineRename.handleCancel}
            onSelectPaths={() => {}}
            onClearSelection={clearSelection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDropToFolder={handleDropToFolder}
            draggingPaths={draggingPaths}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-black/[0.06] dark:border-white/[0.08] text-xs text-[var(--text-quaternary)] shrink-0">
        <span>
          {nodes.length} {t("fileManager.items")}
          {selectedPaths.size > 0 &&
            ` · ${selectedPaths.size} ${t("fileManager.selected")}`}
        </span>
        <span className="truncate ml-4 font-mono opacity-80">
          {`ssh://${connectionLabel || ""}${effectivePath}`}
        </span>
      </div>

      {/* Upload progress panel — shown when there are uploads */}
      {uploadQueue.length > 0 && (
        <div className="shrink-0 border-t border-black/[0.10] dark:border-zinc-800 bg-black/[0.06] dark:bg-zinc-900/60 max-h-36 overflow-y-auto">
          <div className="px-2 py-1 text-[10px] font-semibold text-fg-muted uppercase tracking-wider">
            上传队列
          </div>
          {uploadQueue.map((item) => (
            <div key={item.id} className="flex items-center gap-2 px-2 pb-1.5">
              {/* Status icon */}
              <span className="shrink-0">
                {item.status === "done" ? (
                  <CheckCircle size={12} className="text-emerald-400" />
                ) : item.status === "error" ? (
                  <XCircle size={12} className="text-red-400" />
                ) : (
                  <Upload size={12} className="text-blue-400 animate-pulse" />
                )}
              </span>

              <div className="flex-1 min-w-0">
                {/* File name + size */}
                <div className="flex items-center justify-between gap-1 text-[10px]">
                  <span
                    className="truncate text-fg-secondary"
                    title={item.filename}
                  >
                    {item.filename}
                  </span>
                  <span className="shrink-0 text-fg-muted/70">
                    {item.status === "uploading"
                      ? `${formatBytes(item.loaded)} / ${formatBytes(item.size)}`
                      : formatBytes(item.size)}
                  </span>
                </div>
                {/* Progress bar */}
                {(item.status === "uploading" || item.status === "pending") && (
                  <div className="mt-0.5 h-1 rounded-full bg-black/[0.10] dark:bg-zinc-700 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-200"
                      style={{
                        width: `${item.size > 0 ? Math.round((item.loaded / item.size) * 100) : 0}%`,
                      }}
                    />
                  </div>
                )}
                {item.status === "error" && item.error && (
                  <div className="text-[9px] text-red-400 truncate">
                    {item.error}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
        tabIndex={-1}
      />

      {/* Context menu portal */}
      {contextMenu}

      {/* New folder modal */}
      <NewFolderModal
        open={showNewFolder}
        onClose={() => setShowNewFolder(false)}
        onConfirm={handleMkdir}
      />

      {/* Delete confirmation */}
      <Modal
        open={deleteConfirm}
        onCancel={() => setDeleteConfirm(false)}
        title={t("fileManager.delete")}
        onOk={handleDelete}
        okText={t("common.confirm")}
        cancelText={t("common.cancel")}
        okButtonProps={{ danger: true }}
      >
        <p className="text-sm">
          {t("fileManager.deleteConfirmText", {
            count: selectedPaths.size,
            defaultValue: `确定删除选中的 ${selectedPaths.size} 个项目？`,
          })}
        </p>
      </Modal>
    </div>
  );
}
