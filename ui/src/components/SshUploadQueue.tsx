/**
 * Upload queue types, panel, SSH drag MIME, and DnD/context-menu hooks
 * extracted from SshFileTree to keep that file ≤ 500 lines.
 */
import {
  type ContextMenuItem,
  type FileNode,
  type ViewMode,
} from "@tokimo/ui";
import {
  Download,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { useCallback, useRef, useState, type Dispatch, type DragEvent, type MouseEvent, type SetStateAction } from "react";
import { ApiError, terminalApi } from "../api/client";
import { formatBytes } from "./ssh-terminal-utils";

// ── Upload queue types ──────────────────────────────────────────────────────

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

// ── Upload queue panel ──────────────────────────────────────────────────────

interface UploadQueuePanelProps {
  uploadQueue: UploadQueue;
}

export function UploadQueuePanel({ uploadQueue }: UploadQueuePanelProps) {
  if (uploadQueue.length === 0) return null;
  return (
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
              <span className="truncate text-fg-secondary" title={item.filename}>
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
              <div className="text-[9px] text-red-400 truncate">{item.error}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── SSH internal drag MIME type ─────────────────────────────────────────────

export const SSH_PATHS_MIME = "application/x-ssh-paths";

function getParentPathDnd(p: string): string {
  return p.replace(/\/[^/]+$/, "") || "/";
}

// ── useSshFileDnd ───────────────────────────────────────────────────────────

interface UseSshFileDndParams {
  terminalId: string;
  nodes: FileNode[];
  selectedPaths: Set<string>;
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
  viewMode: ViewMode;
  columnLeafPath: string | null;
  currentPath: string;
  onMoveSuccess: () => void;
  onError: (msg: string) => void;
}

export function useSshFileDnd({
  terminalId,
  nodes,
  selectedPaths,
  setSelectedPaths,
  viewMode,
  columnLeafPath,
  currentPath,
  onMoveSuccess,
  onError,
}: UseSshFileDndParams) {
  const [draggingPaths, setDraggingPaths] = useState<Set<string>>(new Set());
  const [isDragOver, setIsDragOver] = useState(false);
  const dragEnterCount = useRef(0);
  const isInternalDragRef = useRef(false);

  const handleDragStart = useCallback(
    (node: FileNode, contextNodes: FileNode[], e: DragEvent) => {
      let paths: Set<string>;
      if (!selectedPaths.has(node.path)) {
        setSelectedPaths(new Set([node.path]));
        paths = new Set([node.path]);
      } else {
        paths = new Set(selectedPaths);
      }
      setDraggingPaths(paths);
      isInternalDragRef.current = true;
      // Write internal drag payload using our MIME type
      const source = contextNodes.length > 0 ? contextNodes : nodes;
      const dragPaths = source.filter((n) => paths.has(n.path)).map((n) => n.path);
      e.dataTransfer.setData(
        SSH_PATHS_MIME,
        JSON.stringify(dragPaths.length > 0 ? dragPaths : [node.path]),
      );
    },
    [selectedPaths, setSelectedPaths, nodes],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingPaths(new Set());
    isInternalDragRef.current = false;
  }, []);

  /**
   * Unified drop handler — `targetDir` is the absolute remote directory.
   * Used by folder items, sub-column blank areas, and the root container.
   */
  const handleDropToPath = useCallback(
    (targetDir: string, e: DragEvent) => {
      isInternalDragRef.current = false;
      setIsDragOver(false);
      dragEnterCount.current = 0;
      const raw = e.dataTransfer.getData(SSH_PATHS_MIME);
      if (!raw) return;
      let pathList: string[];
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        pathList = parsed.filter((x): x is string => typeof x === "string");
      } catch {
        return;
      }
      // Same-terminal move: for each path whose parent !== targetDir and not
      // dropping a directory into itself or a descendant, call mv then refresh once.
      (async () => {
        let moved = false;
      for (const fromPath of pathList) {
        const parent = getParentPathDnd(fromPath);
        if (parent === targetDir) continue;
        if (fromPath === targetDir || targetDir.startsWith(`${fromPath}/`)) {
          continue;
        }
        try {
          await terminalApi.mv(terminalId, fromPath, targetDir);
          moved = true;
        } catch (err) {
          if (err instanceof ApiError) onError(err.message);
        }
      }
        if (moved) onMoveSuccess();
      })();
      setDraggingPaths(new Set());
    },
    [terminalId, onMoveSuccess, onError],
  );

  const handleDropToFolder = useCallback(
    (targetNode: FileNode, e: DragEvent) => {
      if (!targetNode.isDirectory) return;
      handleDropToPath(targetNode.path, e);
    },
    [handleDropToPath],
  );

  const handleContainerDragOver = useCallback((e: DragEvent) => {
    if (e.dataTransfer.types.includes(SSH_PATHS_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }, []);

  const handleContainerDragEnter = useCallback((e: DragEvent) => {
    dragEnterCount.current++;
    if (e.dataTransfer.types.includes(SSH_PATHS_MIME)) {
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
    (e: DragEvent) => {
      dragEnterCount.current = 0;
      setIsDragOver(false);
      // In column mode, route to the deepest visible path.
      const targetDir =
        viewMode === "column" && columnLeafPath ? columnLeafPath : currentPath;
      e.preventDefault();
      handleDropToPath(targetDir, e);
    },
    [viewMode, columnLeafPath, currentPath, handleDropToPath],
  );

  return {
    draggingPaths,
    isDragOver,
    handleDragStart,
    handleDragEnd,
    handleDropToPath,
    handleDropToFolder,
    handleContainerDragOver,
    handleContainerDragEnter,
    handleContainerDragLeave,
    handleContainerDrop,
  };
}

// ── useSshFileTreeMenus ─────────────────────────────────────────────────────

interface FileMenuCallbacks {
  navigateTo: (path: string) => void;
  handleOpenFile: (node: FileNode) => void;
  handleDownload: (node: FileNode) => void;
  startRename: (path: string) => void;
  setDeleteConfirm: (v: boolean) => void;
  setShowNewFolder: (v: boolean) => void;
  refresh: () => void;
  triggerUpload: (dir: string) => void;
}

interface FileMenuState {
  selectedPaths: Set<string>;
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
  connected: boolean;
  currentPath: string;
  openCtxMenu: (e: MouseEvent, items: ContextMenuItem[]) => void;
}

export function useSshFileTreeMenus(
  cbs: FileMenuCallbacks,
  state: FileMenuState,
) {
  const ctxTarget = useRef<FileNode | null>(null);

  const handleItemContextMenu = useCallback(
    (node: FileNode, e: MouseEvent) => {
      e.preventDefault();
      ctxTarget.current = node;
      if (!state.selectedPaths.has(node.path)) {
        state.setSelectedPaths(new Set([node.path]));
      }
      const multi = state.selectedPaths.has(node.path) ? state.selectedPaths.size : 1;
      const items: ContextMenuItem[] = [];

      if (node.isDirectory) {
        items.push({
          key: "open",
          label: "打开",
          icon: <FolderOpen size={13} />,
          onClick: () => cbs.navigateTo(node.path),
        });
      } else {
        items.push({
          key: "open",
          label: "打开",
          icon: <FilePlus size={13} />,
          onClick: () => cbs.handleOpenFile(node),
        });
      }

      items.push(
        { key: "d1", type: "divider" },
        {
          key: "rename",
          label: "重命名",
          icon: <Pencil size={13} />,
          onClick: () => cbs.startRename(node.path),
          disabled: multi > 1,
        },
        {
          key: "download",
          label: "下载",
          icon: <Download size={13} />,
          onClick: () => cbs.handleDownload(node),
          disabled: node.isDirectory,
        },
        { key: "d2", type: "divider" },
        {
          key: "delete",
          label: multi > 1 ? `删除 (${multi})` : "删除",
          icon: <Trash2 size={13} />,
          danger: true,
          onClick: () => cbs.setDeleteConfirm(true),
        },
      );

      state.openCtxMenu(e, items);
    },
    // biome-ignore lint/react-hooks/exhaustive-deps: cbs/state are stable object refs
    [cbs, state],
  );

  const handleEmptyContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      state.setSelectedPaths(new Set());
      const items: ContextMenuItem[] = [
        {
          key: "new-folder",
          label: "新建文件夹",
          icon: <FolderPlus size={13} />,
          onClick: () => cbs.setShowNewFolder(true),
        },
        {
          key: "upload",
          label: "上传文件",
          icon: <Upload size={13} />,
          onClick: () => cbs.triggerUpload(state.currentPath),
          disabled: !state.connected,
        },
        { key: "d1", type: "divider" },
        {
          key: "refresh",
          label: "刷新",
          icon: <RefreshCw size={13} />,
          onClick: cbs.refresh,
        },
      ];
      state.openCtxMenu(e, items);
    },
    // biome-ignore lint/react-hooks/exhaustive-deps: cbs/state are stable object refs
    [cbs, state],
  );

  return { ctxTarget, handleItemContextMenu, handleEmptyContextMenu };
}
