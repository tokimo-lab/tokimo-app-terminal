import { Button } from "@tokimo/ui";
import { ChevronUp, FolderPlus, RefreshCw, Upload } from "lucide-react";
import { useRef } from "react";
import { breadcrumbs } from "../../lib/path";

interface FileToolbarProps {
  path: string;
  loading: boolean;
  onNavigate: (path: string) => void;
  onUp: () => void;
  onRefresh: () => void;
  onNewFolder: () => void;
  onUpload: (files: FileList) => void;
}

/** Breadcrumb navigation + primary actions for the SSH file browser. */
export function FileToolbar({
  path,
  loading,
  onNavigate,
  onUp,
  onRefresh,
  onNewFolder,
  onUpload,
}: FileToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const crumbs = breadcrumbs(path);

  return (
    <div className="flex flex-col gap-2 border-b border-white/10 p-2">
      <div className="flex items-center gap-2">
        <Button size="small" onClick={onUp} disabled={path === "/"} title="Up">
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button size="small" onClick={onNewFolder}>
          <FolderPlus className="mr-1 h-4 w-4" />
          New folder
        </Button>
        <Button size="small" onClick={() => fileInputRef.current?.click()}>
          <Upload className="mr-1 h-4 w-4" />
          Upload
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0)
              onUpload(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          size="small"
          className="ml-auto"
          onClick={onRefresh}
          loading={loading}
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-0.5 font-mono text-xs text-zinc-400">
        {crumbs.map((crumb, idx) => (
          <span key={crumb.path} className="flex items-center gap-0.5">
            {idx > 0 && <span className="text-zinc-600">/</span>}
            <button
              type="button"
              className="cursor-pointer rounded px-1 py-0.5 hover:bg-white/10 hover:text-zinc-200"
              onClick={() => onNavigate(crumb.path)}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
