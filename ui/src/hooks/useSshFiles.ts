import { useCallback, useEffect, useRef, useState } from "react";
import { terminalApi } from "../api/client";
import type { SshFileEntry } from "../api/types";
import { joinPath, parentPath } from "../lib/path";

/** Directory entries sorted with directories first, then alphabetically by name. */
function sortEntries(entries: SshFileEntry[]): SshFileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export interface UseSshFiles {
  path: string;
  entries: SshFileEntry[];
  loading: boolean;
  error: string | null;
  navigate: (next: string) => void;
  goUp: () => void;
  refresh: () => void;
  mkdir: (name: string) => Promise<void>;
  remove: (fullPath: string) => Promise<void>;
  rename: (fullPath: string, newName: string) => Promise<void>;
  move: (fullPath: string, destDir: string) => Promise<void>;
  upload: (files: FileList | File[]) => Promise<void>;
  download: (entry: SshFileEntry) => void;
}

/**
 * Stateful remote file browser logic for an SSH terminal: directory navigation
 * plus mkdir / rm / rename / mv / upload / download mutations. Each mutation
 * refreshes the current directory on success and rethrows on failure so the
 * caller can surface a toast.
 */
export function useSshFiles(terminalId: string): UseSshFiles {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<SshFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const pathRef = useRef(path);
  pathRef.current = path;

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is a manual refresh trigger
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    terminalApi
      .ls(terminalId, path)
      .then((res) => {
        if (!cancelled) setEntries(sortEntries(res.entries));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setEntries([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [terminalId, path, version]);

  const navigate = useCallback((next: string) => setPath(next), []);
  const goUp = useCallback(() => setPath((p) => parentPath(p)), []);

  const mkdir = useCallback(
    async (name: string) => {
      await terminalApi.mkdir(terminalId, joinPath(pathRef.current, name));
      refresh();
    },
    [terminalId, refresh],
  );

  const remove = useCallback(
    async (fullPath: string) => {
      await terminalApi.rm(terminalId, fullPath);
      refresh();
    },
    [terminalId, refresh],
  );

  const rename = useCallback(
    async (fullPath: string, newName: string) => {
      await terminalApi.rename(
        terminalId,
        fullPath,
        joinPath(pathRef.current, newName),
      );
      refresh();
    },
    [terminalId, refresh],
  );

  const move = useCallback(
    async (fullPath: string, destDir: string) => {
      await terminalApi.mv(terminalId, fullPath, destDir);
      refresh();
    },
    [terminalId, refresh],
  );

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      for (const file of list) {
        await terminalApi.upload(terminalId, pathRef.current, file);
      }
      refresh();
    },
    [terminalId, refresh],
  );

  const download = useCallback(
    (entry: SshFileEntry) => {
      const url = terminalApi.downloadUrl(
        terminalId,
        joinPath(pathRef.current, entry.name),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = entry.name;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
    [terminalId],
  );

  return {
    path,
    entries,
    loading,
    error,
    navigate,
    goUp,
    refresh,
    mkdir,
    remove,
    rename,
    move,
    upload,
    download,
  };
}
