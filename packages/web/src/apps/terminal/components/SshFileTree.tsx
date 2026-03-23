/**
 * Remote file browser panel for SSH terminal.
 * Lists files via the /api/ssh-terminals/{id}/ls endpoint.
 * Reuses the visual components from the media-library FileManager
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
  Download,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWindowManager } from "../../contexts/WindowManagerContext";
import { api } from "../../generated/rust-api";
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

interface SshFileTreeProps {
  terminalId: string;
  connected: boolean;
}

/** Convert SSH ls entries into FileNode[] that FileGrid understands. */
function toFileNodes(entries: SshFileEntry[], basePath: string): FileNode[] {
  return entries.map((e) => {
    const fullPath = basePath === "/" ? `/${e.name}` : `${basePath}/${e.name}`;
    return {
      name: e.name,
      path: fullPath,
      isDirectory: e.isDir,
      size: e.size || null,
      modifiedAt: null,
      mode: null,
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

const EMPTY_SET = new Set<string>();
const noopDrag = (_n: FileNode, _e: React.DragEvent) => {};

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
}: SshFileTreeProps) {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState("/");
  const [rawNodes, setRawNodes] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

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
      // Open file in a WindowManager window with Monaco editor
      windowManager.openWindow({
        type: "text",
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
    [openCtxMenu, refresh, t],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="border-b border-black/[0.06] dark:border-white/[0.08] shrink-0">
        <FileBreadcrumb
          currentPath={currentPath}
          onNavigate={navigateTo}
          sourceType="ssh"
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
            onDragStart={noopDrag}
            onDragEnd={() => {}}
            onDropToFolder={noopDrag}
            draggingPaths={EMPTY_SET}
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
      </div>

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
