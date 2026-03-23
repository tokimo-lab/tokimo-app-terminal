/**
 * Remote file directory tree panel for SSH terminal.
 * Lists files via the /api/ssh-terminals/{id}/ls endpoint.
 * Clicking a directory sends `cd <path>` to the terminal.
 */
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../generated/rust-api";
import type { SshFileEntry } from "../../generated/rust-types/SshFileEntry";
import { formatBytes } from "./ssh-terminal-utils";

interface SshFileTreeProps {
  terminalId: string;
  connected: boolean;
}

export default function SshFileTree({
  terminalId,
  connected,
}: SshFileTreeProps) {
  const [cwd, setCwd] = useState("/");
  const [entries, setEntries] = useState<SshFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [childEntries, setChildEntries] = useState<
    Record<string, SshFileEntry[]>
  >({});

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

  // Load root directory when connected
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    setLoading(true);
    fetchDir(cwd).then((result) => {
      if (!cancelled) {
        setEntries(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, connected, fetchDir]);

  const handleNavigate = useCallback((fullPath: string) => {
    setCwd(fullPath);
    setExpandedDirs(new Set());
    setChildEntries({});
  }, []);

  const handleGoUp = useCallback(() => {
    if (cwd === "/") return;
    const parent = cwd.replace(/\/[^/]+$/, "") || "/";
    setCwd(parent);
    setExpandedDirs(new Set());
    setChildEntries({});
  }, [cwd]);

  const toggleExpand = useCallback(
    async (fullPath: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(fullPath)) {
          next.delete(fullPath);
        } else {
          next.add(fullPath);
        }
        return next;
      });
      if (!childEntries[fullPath]) {
        const result = await fetchDir(fullPath);
        setChildEntries((prev) => ({ ...prev, [fullPath]: result }));
      }
    },
    [childEntries, fetchDir],
  );

  const handleRefresh = useCallback(() => {
    setExpandedDirs(new Set());
    setChildEntries({});
    fetchDir(cwd).then(setEntries);
  }, [cwd, fetchDir]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-zinc-800/60 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={handleGoUp}
            disabled={cwd === "/"}
            className="p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="上级目录"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <span className="text-xs text-zinc-400 truncate font-mono">
            {cwd}
          </span>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
          title="刷新"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-1 py-0.5 text-xs font-mono">
        {loading ? (
          <div className="text-zinc-600 px-2 py-1">加载中...</div>
        ) : entries.length === 0 ? (
          <div className="text-zinc-600 px-2 py-1">空目录</div>
        ) : (
          entries.map((entry) => (
            <FileTreeNode
              key={entry.name}
              entry={entry}
              basePath={cwd}
              depth={0}
              expandedDirs={expandedDirs}
              childEntries={childEntries}
              onToggleExpand={toggleExpand}
              onNavigate={handleNavigate}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── File tree node ──

function FileTreeNode({
  entry,
  basePath,
  depth,
  expandedDirs,
  childEntries,
  onToggleExpand,
  onNavigate,
}: {
  entry: SshFileEntry;
  basePath: string;
  depth: number;
  expandedDirs: Set<string>;
  childEntries: Record<string, SshFileEntry[]>;
  onToggleExpand: (path: string) => void;
  onNavigate: (path: string) => void;
}) {
  const fullPath =
    basePath === "/" ? `/${entry.name}` : `${basePath}/${entry.name}`;
  const isExpanded = expandedDirs.has(fullPath);
  const children = childEntries[fullPath];

  if (!entry.isDir) {
    return (
      <div
        className="flex items-center gap-1 py-0.5 text-zinc-500 hover:bg-zinc-800/40 rounded px-1 cursor-default"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        <File className="h-3 w-3 shrink-0 text-zinc-600" />
        <span className="truncate">{entry.name}</span>
        {entry.size > 0 && (
          <span className="ml-auto text-zinc-700 shrink-0">
            {formatBytes(entry.size)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: file tree node */}
      <div
        className="flex items-center gap-1 py-0.5 text-zinc-300 hover:bg-zinc-800/50 rounded px-1 cursor-pointer select-none"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onClick={() => onToggleExpand(fullPath)}
        onDoubleClick={() => onNavigate(fullPath)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onToggleExpand(fullPath);
        }}
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />
        )}
        {isExpanded ? (
          <FolderOpen className="h-3 w-3 shrink-0 text-amber-500/80" />
        ) : (
          <Folder className="h-3 w-3 shrink-0 text-amber-500/80" />
        )}
        <span className="truncate">{entry.name}</span>
      </div>
      {isExpanded && children && (
        <div>
          {children.length === 0 ? (
            <div
              className="text-zinc-700 py-0.5"
              style={{ paddingLeft: `${(depth + 1) * 14 + 4}px` }}
            >
              (空)
            </div>
          ) : (
            children.map((child) => (
              <FileTreeNode
                key={child.name}
                entry={child}
                basePath={fullPath}
                depth={depth + 1}
                expandedDirs={expandedDirs}
                childEntries={childEntries}
                onToggleExpand={onToggleExpand}
                onNavigate={onNavigate}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
