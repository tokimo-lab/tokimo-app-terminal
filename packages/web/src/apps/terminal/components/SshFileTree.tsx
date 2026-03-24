/**
 * Remote file browser panel for SSH terminal.
 * Lists files via the /api/ssh-terminals/{id}/ls endpoint.
 * Reuses the visual components from the app FileManager
 * (FileGrid, FileBreadcrumb, FileToolbar).
 *
 * Supports: navigate, new folder, rename, delete, download,
 * double-click to open text files (with SSH-backed read/write).
 */
import {
  type ContextMenuItem,
  Modal,
  Spin,
  useContextMenu,
} from "@tokiomo/components";
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
import { useWindowManager } from "../../contexts/WindowManagerContext";
import { api } from "../../generated/rust-api";
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

import type { SshFileEntry } from "../../generated/rust-types/SshFileEntry";
import { FileBreadcrumb } from "../file-manager/FileBreadcrumb";
import { FileGrid } from "../file-manager/FileGrid";
import { NewFolderModal, RenameModal } from "../file-manager/FileModals";
import { FileToolbar } from "../file-manager/FileToolbar";
import type {
  FileNode,
  SortBy,
  SortDir,
  ViewMode,
} from "../file-manager/types";
import { sortNodes } from "../file-manager/types";

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
}

/** Convert SSH ls entries into FileNode[] that FileGrid understands. */
function toFileNodes(entries: SshFileEntry[], basePath: string): FileNode[] {
  return entries.map((e) => {
    const fullPath = basePath === "/" ? `/${e.name}` : `${basePath}/${e.name}`;
    const owner =
      e.owner || e.group ? `${e.owner ?? ""}:${e.group ?? ""}` : null;
    return {
      name: e.name,
      path: fullPath,
      isDirectory: e.isDir,
      size: e.size || null,
      modifiedAt: e.modifiedAt ?? null,
      mode: e.mode ?? null,
      owner,
    };
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

const IMAGE_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "tiff",
  "tif",
  "avif",
  "heic",
  "heif",
]);
const VIDEO_EXTS = new Set([
  "mp4",
  "mkv",
  "avi",
  "mov",
  "wmv",
  "flv",
  "webm",
  "m4v",
  "ts",
]);
const AUDIO_EXTS = new Set(["mp3", "flac", "aac", "ogg", "wav", "m4a", "opus"]);

/** Determine the window type for a file based on its extension. */
function getFileWindowType(
  name: string,
): "image" | "video" | "audio" | "pdf" | "text" {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  return "text";
}

/** Build the download URL for an SSH file. */
function buildDownloadUrl(terminalId: string, filePath: string): string {
  const base =
    (typeof window !== "undefined" &&
      (import.meta.env as Record<string, string>).RUST_SERVER) ||
    "";
  return `${base}/api/ssh-terminals/${encodeURIComponent(terminalId)}/download?path=${encodeURIComponent(filePath)}`;
}

export default function SshFileTree({
  terminalId,
  connected,
  uploadQueue,
  onUploadFiles,
  onPathChange,
  connectionLabel,
}: SshFileTreeProps) {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState("/");
  const [rawNodes, setRawNodes] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Drag-and-drop state
  const [draggingPaths, setDraggingPaths] = useState<Set<string>>(new Set());

  // Hidden file input ref for upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string>("/");

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showHidden, setShowHidden] = useState(false);

  // Modals
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Window manager for opening files in Monaco editor
  const windowManager = useWindowManager();

  // Context menu
  const { open: openCtxMenu, contextMenu } = useContextMenu();
  const ctxTarget = useRef<FileNode | null>(null);

  const fetchDir = useCallback(
    async (path: string) => {
      try {
        const resp = await api.sshTerminal.ls.fetch({
          id: terminalId,
          path,
        });
        return resp.entries;
      } catch {
        return [];
      }
    },
    [terminalId],
  );

  const refresh = useCallback(() => {
    setLoading(true);
    fetchDir(currentPath).then((result) => {
      setRawNodes(toFileNodes(result, currentPath));
      setSelectedPaths(new Set());
      setLoading(false);
    });
  }, [currentPath, fetchDir]);

  const mvMut = api.sshTerminal.mv.useMutation({ onSuccess: refresh });

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
    fetchDir(currentPath).then((result) => {
      if (!cancelled) {
        setRawNodes(toFileNodes(result, currentPath));
        setSelectedPaths(new Set());
        setLoading(false);
      }
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

  useEffect(() => {
    onPathChange?.(currentPath);
  }, [currentPath, onPathChange]);

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
  }, []);

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
    async (newName: string) => {
      if (!renameTarget) return;
      const parent = getParentPath(renameTarget.path);
      const to = joinPath(parent, newName);
      await api.sshTerminal.rename.mutate({
        id: terminalId,
        from: renameTarget.path,
        to,
      });
      setRenameTarget(null);
      refresh();
    },
    [terminalId, renameTarget, refresh],
  );

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
    (node: FileNode, _e: React.DragEvent) => {
      if (!selectedPaths.has(node.path)) {
        setSelectedPaths(new Set([node.path]));
        setDraggingPaths(new Set([node.path]));
      } else {
        setDraggingPaths(new Set(selectedPaths));
      }
    },
    [selectedPaths],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingPaths(new Set());
  }, []);

  const handleDropToFolder = useCallback(
    (targetNode: FileNode, _e: React.DragEvent) => {
      if (!targetNode.isDirectory) return;
      for (const srcPath of draggingPaths) {
        if (srcPath !== targetNode.path) {
          mvMut.mutate({
            id: terminalId,
            from: srcPath,
            toDir: targetNode.path,
          });
        }
      }
      setDraggingPaths(new Set());
    },
    [draggingPaths, terminalId, mvMut],
  );

  const handleDownload = useCallback(
    (path: string) => {
      const a = document.createElement("a");
      a.href = buildDownloadUrl(terminalId, path);
      a.download = "";
      a.click();
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
          onClick: () => setRenameTarget({ path: node.path, name: node.name }),
          disabled: multi > 1,
        },
        {
          key: "download",
          label: t("common.download", "下载"),
          icon: <Download size={13} />,
          onClick: () => handleDownload(node.path),
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
    [selectedPaths, navigateTo, handleOpenFile, handleDownload, openCtxMenu, t],
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

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="border-b border-black/[0.06] dark:border-white/[0.08] shrink-0">
        <FileBreadcrumb
          currentPath={currentPath}
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
        onSetViewMode={setViewMode}
        onSetSortBy={setSortBy}
        onSetSortDir={setSortDir}
        onSetShowHidden={setShowHidden}
        onRefresh={refresh}
      />

      {/* File grid / list */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Spin size="small" />
          </div>
        ) : (
          <FileGrid
            nodes={nodes}
            selectedPaths={selectedPaths}
            viewMode={viewMode}
            renaming={null}
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
            onRenameSubmit={(_path: string, _name: string) => {}}
            onRenameCancel={() => {}}
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
          {`ssh://${connectionLabel || ""}${currentPath}`}
        </span>
      </div>

      {/* Upload progress panel — shown when there are uploads */}
      {uploadQueue.length > 0 && (
        <div className="shrink-0 border-t border-zinc-800 bg-zinc-900/60 max-h-36 overflow-y-auto">
          <div className="px-2 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
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
                    className="truncate text-zinc-300"
                    title={item.filename}
                  >
                    {item.filename}
                  </span>
                  <span className="shrink-0 text-zinc-500">
                    {item.status === "uploading"
                      ? `${formatBytes(item.loaded)} / ${formatBytes(item.size)}`
                      : formatBytes(item.size)}
                  </span>
                </div>
                {/* Progress bar */}
                {(item.status === "uploading" || item.status === "pending") && (
                  <div className="mt-0.5 h-1 rounded-full bg-zinc-700 overflow-hidden">
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

      {/* Rename modal */}
      <RenameModal
        open={!!renameTarget}
        currentName={renameTarget?.name ?? ""}
        onClose={() => setRenameTarget(null)}
        onConfirm={handleRename}
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
