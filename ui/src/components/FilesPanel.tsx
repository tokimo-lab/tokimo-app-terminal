import {
  type ContextMenuItem,
  Empty,
  Modal,
  Spin,
  Table,
  type TableColumn,
  useContextMenu,
  useToast,
} from "@tokimo/ui";
import {
  Download,
  File,
  FilePen,
  Folder,
  FolderInput,
  Pencil,
  Trash2,
} from "lucide-react";
import { type MouseEvent, useState } from "react";
import { useAppCtx } from "../AppContext";
import type { SshFileEntry } from "../api/types";
import { useSshFiles } from "../hooks/useSshFiles";
import { formatBytes } from "../lib/format";
import { joinPath } from "../lib/path";
import { FileToolbar } from "./files/FileToolbar";
import { TextEditModal } from "./files/TextEditModal";
import { PromptModal } from "./PromptModal";

interface FilesPanelProps {
  terminalId: string;
}

type PromptKind = "mkdir" | "rename" | "move";

interface PromptState {
  kind: PromptKind;
  entry?: SshFileEntry;
  title: string;
  label: string;
  defaultValue: string;
  confirmText: string;
}

export function FilesPanel({ terminalId }: FilesPanelProps) {
  const ctx = useAppCtx();
  const toast = useToast();
  const files = useSshFiles(terminalId);
  const { open: openCtxMenu, contextMenu } = useContextMenu();

  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const [editPath, setEditPath] = useState<string | null>(null);

  const reportError = (err: unknown) =>
    toast.error(err instanceof Error ? err.message : String(err));

  const fullPath = (entry: SshFileEntry) => joinPath(files.path, entry.name);

  const openInViewer = (entry: SshFileEntry) => {
    ctx.shell.viewer.openFileViewer({
      filePath: fullPath(entry),
      fileName: entry.name,
      sshTerminalId: terminalId,
    });
  };

  const openEntry = (entry: SshFileEntry) => {
    if (entry.isDir) {
      files.navigate(fullPath(entry));
      return;
    }
    openInViewer(entry);
  };

  const promptMkdir = () =>
    setPrompt({
      kind: "mkdir",
      title: "New folder",
      label: "Folder name",
      defaultValue: "",
      confirmText: "Create",
    });

  const promptRename = (entry: SshFileEntry) =>
    setPrompt({
      kind: "rename",
      entry,
      title: `Rename ${entry.name}`,
      label: "New name",
      defaultValue: entry.name,
      confirmText: "Rename",
    });

  const promptMove = (entry: SshFileEntry) =>
    setPrompt({
      kind: "move",
      entry,
      title: `Move ${entry.name}`,
      label: "Destination directory",
      defaultValue: files.path,
      confirmText: "Move",
    });

  const confirmDelete = (entry: SshFileEntry) => {
    Modal.confirm({
      title: `Delete ${entry.name}?`,
      content: entry.isDir
        ? "This directory and its contents will be permanently removed."
        : "This file will be permanently removed.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: () =>
        files.remove(fullPath(entry)).catch((err: unknown) => {
          reportError(err);
          throw err;
        }),
    });
  };

  const runPrompt = async (value: string) => {
    if (!prompt) return;
    setPromptBusy(true);
    try {
      if (prompt.kind === "mkdir") {
        await files.mkdir(value);
      } else if (prompt.kind === "rename" && prompt.entry) {
        await files.rename(fullPath(prompt.entry), value);
      } else if (prompt.kind === "move" && prompt.entry) {
        await files.move(fullPath(prompt.entry), value);
      }
      setPrompt(null);
    } catch (err) {
      reportError(err);
    } finally {
      setPromptBusy(false);
    }
  };

  const handleUpload = (list: FileList) => {
    files
      .upload(list)
      .then(() => toast.success(`Uploaded ${list.length} file(s)`))
      .catch(reportError);
  };

  const openRowMenu = (e: MouseEvent, entry: SshFileEntry) => {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      {
        key: "open",
        label: "Open",
        icon: <File className="h-4 w-4" />,
        onClick: () => openEntry(entry),
      },
    ];
    if (!entry.isDir) {
      items.push({
        key: "edit",
        label: "Edit as text",
        icon: <FilePen className="h-4 w-4" />,
        onClick: () => setEditPath(fullPath(entry)),
      });
      items.push({
        key: "download",
        label: "Download",
        icon: <Download className="h-4 w-4" />,
        onClick: () => files.download(entry),
      });
    }
    items.push({ key: "d1", type: "divider" });
    items.push({
      key: "rename",
      label: "Rename",
      icon: <Pencil className="h-4 w-4" />,
      onClick: () => promptRename(entry),
    });
    items.push({
      key: "move",
      label: "Move",
      icon: <FolderInput className="h-4 w-4" />,
      onClick: () => promptMove(entry),
    });
    items.push({ key: "d2", type: "divider" });
    items.push({
      key: "delete",
      label: "Delete",
      icon: <Trash2 className="h-4 w-4" />,
      danger: true,
      onClick: () => confirmDelete(entry),
    });
    openCtxMenu(e, items);
  };

  const columns: TableColumn<SshFileEntry>[] = [
    {
      key: "name",
      title: "Name",
      dataIndex: "name",
      render: (_value, record) => (
        <span className="flex items-center gap-2">
          {record.isDir ? (
            <Folder className="h-4 w-4 shrink-0 text-sky-400" />
          ) : (
            <File className="h-4 w-4 shrink-0 text-zinc-400" />
          )}
          <span className="truncate text-zinc-200">{record.name}</span>
        </span>
      ),
    },
    {
      key: "size",
      title: "Size",
      dataIndex: "size",
      width: 100,
      align: "right",
      render: (_value, record) => (
        <span className="text-zinc-400">
          {record.isDir ? "" : formatBytes(record.size)}
        </span>
      ),
    },
    {
      key: "modifiedAt",
      title: "Modified",
      dataIndex: "modifiedAt",
      width: 170,
      render: (_value, record) => (
        <span className="text-zinc-400">{record.modifiedAt ?? ""}</span>
      ),
    },
    {
      key: "mode",
      title: "Mode",
      dataIndex: "mode",
      width: 120,
      render: (_value, record) => (
        <span className="font-mono text-zinc-500">{record.mode ?? ""}</span>
      ),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      <FileToolbar
        path={files.path}
        loading={files.loading}
        onNavigate={files.navigate}
        onUp={files.goUp}
        onRefresh={files.refresh}
        onNewFolder={promptMkdir}
        onUpload={handleUpload}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {files.error ? (
          <div className="p-3 text-xs text-red-300">{files.error}</div>
        ) : files.loading && files.entries.length === 0 ? (
          <div className="flex h-40 items-center justify-center">
            <Spin />
          </div>
        ) : files.entries.length === 0 ? (
          <div className="flex h-40 items-center justify-center">
            <Empty description="Empty directory" />
          </div>
        ) : (
          <Table<SshFileEntry>
            columns={columns}
            dataSource={files.entries}
            rowKey="name"
            size="small"
            pagination={false}
            rowClassName="cursor-pointer"
            onRow={(record) => ({
              onDoubleClick: () => openEntry(record),
              onContextMenu: (e) => openRowMenu(e, record),
            })}
          />
        )}
      </div>

      <PromptModal
        open={prompt !== null}
        title={prompt?.title ?? ""}
        label={prompt?.label}
        defaultValue={prompt?.defaultValue}
        confirmText={prompt?.confirmText}
        loading={promptBusy}
        onClose={() => setPrompt(null)}
        onConfirm={runPrompt}
      />

      <TextEditModal
        terminalId={terminalId}
        filePath={editPath}
        onClose={() => setEditPath(null)}
        onError={reportError}
        onSaved={() => {
          toast.success("Saved");
          files.refresh();
        }}
      />

      {contextMenu}
    </div>
  );
}
