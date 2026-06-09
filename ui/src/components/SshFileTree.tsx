/**
 * Remote file browser panel for SSH terminal.
 * Lists files via the /api/apps/terminal/connections/{id}/ls endpoint.
 * Reuses the visual components from the app FileManager
 * (FileGrid, FileBreadcrumb, FileToolbar).
 *
 * Supports: navigate, new folder, rename, delete, download,
 * double-click to open files (via shell viewer with SSH-backed read/write).
 */
import {
  FileBreadcrumb,
  FileColumnView,
  FileGrid,
  type FileNode,
  FileToolbar,
  Modal,
  NewFolderModal,
  type SortBy,
  type SortDir,
  Spin,
  sortNodes,
  useContextMenu,
  useInlineRename,
  type ViewMode,
} from "@tokimo/ui";
import { FolderOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { useAppCtx } from "../AppContext";
import { ApiError, terminalApi } from "../api/client";
import type { SshFileEntry } from "../api/types";
import { useComponentPreference } from "../hooks/use-preference";
import { useMessage } from "../hooks/use-message";
import {
  SSH_PATHS_MIME,
  UploadQueuePanel,
  useSshFileDnd,
  useSshFileTreeMenus,
  type SshFileTreeProps,
} from "./SshUploadQueue";

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

export default function SshFileTree({
  terminalId,
  connected,
  uploadQueue,
  onUploadFiles,
  onPathChange,
  connectionLabel,
  initialPath,
}: SshFileTreeProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || "/");
  const [rawNodes, setRawNodes] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [pathNotFound, setPathNotFound] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [subColumnRefreshKey, setSubColumnRefreshKey] = useState(0);
  const bumpSubColumnRefresh = useCallback(() => setSubColumnRefreshKey((k) => k + 1), []);

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

  // Window manager for opening files via shell viewer
  const ctx = useAppCtx();
  const message = useMessage();

  // Context menu
  const { open: openCtxMenu, contextMenu } = useContextMenu();

  const fetchDir = useCallback(async (path: string) => {
    const resp = await terminalApi.ls(terminalId, path);
    return resp.entries;
  }, [terminalId]);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchDir(currentPath)
      .then((result) => {
        setPathNotFound(false);
        setRawNodes(toFileNodes(result, currentPath));
        setSelectedPaths(new Set());
      })
      .catch((err: ApiError) => {
        if (err.status === 404) {
          setPathNotFound(true);
          setRawNodes([]);
        }
      })
      .finally(() => setLoading(false));
  }, [currentPath, fetchDir]);

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
      .catch((err: ApiError) => {
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
  const fetchSshDirectory = useCallback(async (dirPath: string): Promise<FileNode[]> => {
    const resp = await terminalApi.ls(terminalId, dirPath);
    return toFileNodes(resp.entries, dirPath);
  }, [terminalId]);

  // ── Actions ──

  const handleMkdir = useCallback(async (name: string) => {
    const dirPath = joinPath(currentPath, name);
    await terminalApi.mkdir(terminalId, dirPath);
    setShowNewFolder(false);
    refresh();
  }, [terminalId, currentPath, refresh]);

  const handleRename = useCallback(async (oldPath: string, newName: string) => {
    const parent = getParentPath(oldPath);
    const to = joinPath(parent, newName);
    await terminalApi.rename(terminalId, oldPath, to);
  }, [terminalId]);

  const inlineRename = useInlineRename({
    renameFn: handleRename,
    onSuccess: refresh,
  });

  const handleDelete = useCallback(async () => {
    for (const path of selectedPaths) {
      await terminalApi.rm(terminalId, path);
    }
    setDeleteConfirm(false);
    setSelectedPaths(new Set());
    refresh();
  }, [terminalId, selectedPaths, refresh]);

  const dnd = useSshFileDnd({
    terminalId,
    nodes,
    selectedPaths,
    setSelectedPaths,
    viewMode,
    columnLeafPath,
    currentPath,
    onMoveSuccess: () => {
      refresh();
      bumpSubColumnRefresh();
    },
    onError: (msg) => message.error(msg),
  });

  const handleDownload = useCallback(
    (node: FileNode) => {
      const a = document.createElement("a");
      a.href = terminalApi.downloadUrl(terminalId, node.path);
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
      // Open file in a shell viewer window; let the shell infer the viewer type
      ctx.shell.viewer.openFileViewer({
        filePath: node.path,
        fileName: node.name,
        sshTerminalId: terminalId,
      });
    },
    [terminalId, navigateTo, ctx],
  );

  const handleItemClick = useCallback((node: FileNode, e: MouseEvent) => {
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

  const triggerUpload = useCallback((targetDir: string) => {
    uploadTargetRef.current = targetDir;
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      onUploadFiles(uploadTargetRef.current, files);
      // reset so the same file can be re-selected
      e.target.value = "";
    },
    [onUploadFiles],
  );

  const menus = useSshFileTreeMenus(
    {
      navigateTo,
      handleOpenFile,
      handleDownload,
      startRename: inlineRename.startRename,
      setDeleteConfirm,
      setShowNewFolder,
      refresh,
      triggerUpload,
    },
    {
      selectedPaths,
      setSelectedPaths,
      connected,
      currentPath,
      openCtxMenu,
    },
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: cross-storage drop target
    <div
      className={[
        "flex flex-col h-full",
        dnd.isDragOver
          ? "outline-2 outline-dashed outline-blue-400/60 -outline-offset-2 bg-blue-500/5"
          : "",
      ].join(" ")}
      onDragOver={dnd.handleContainerDragOver}
      onDragEnter={dnd.handleContainerDragEnter}
      onDragLeave={dnd.handleContainerDragLeave}
      onDrop={dnd.handleContainerDrop}
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
            <span>路径不存在</span>
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
            acceptsExternalDrop={(e) => e.dataTransfer.types.includes(SSH_PATHS_MIME)}
            onExternalDropToDir={dnd.handleDropToPath}
            onNavigate={navigateTo}
            onLeafPathChange={setColumnLeafPath}
            onItemClick={handleItemClick}
            onItemDoubleClick={handleItemDoubleClick}
            onItemContextMenu={menus.handleItemContextMenu}
            onEmptyContextMenu={menus.handleEmptyContextMenu}
            onRenameSubmit={inlineRename.handleSubmit}
            onRenameCancel={inlineRename.handleCancel}
            onClearSelection={clearSelection}
            onDragStart={dnd.handleDragStart}
            onDragEnd={dnd.handleDragEnd}
            onDropToFolder={dnd.handleDropToFolder}
            onDropToDir={dnd.handleDropToPath}
            draggingPaths={dnd.draggingPaths}
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
            onItemContextMenu={menus.handleItemContextMenu}
            onEmptyContextMenu={menus.handleEmptyContextMenu}
            onRenameSubmit={inlineRename.handleSubmit}
            onRenameCancel={inlineRename.handleCancel}
            onSelectPaths={() => {}}
            onClearSelection={clearSelection}
            onDragStart={dnd.handleDragStart}
            onDragEnd={dnd.handleDragEnd}
            onDropToFolder={dnd.handleDropToFolder}
            draggingPaths={dnd.draggingPaths}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-black/[0.06] dark:border-white/[0.08] text-xs text-[var(--text-quaternary)] shrink-0">
        <span>
          {nodes.length} 项
          {selectedPaths.size > 0 &&
            ` · ${selectedPaths.size} 已选择`}
        </span>
        <span className="truncate ml-4 font-mono opacity-80">
          {`ssh://${connectionLabel || ""}${effectivePath}`}
        </span>
      </div>

      {/* Upload progress panel — shown when there are uploads */}
      <UploadQueuePanel uploadQueue={uploadQueue} />

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
        title="删除"
        onOk={handleDelete}
        okText="确认"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <p className="text-sm">
          {`确定删除选中的 ${selectedPaths.size} 个项目？`}
        </p>
      </Modal>
    </div>
  );
}
