import { FileText, Folder, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { terminalApi } from "../api/client";
import type { SshFileEntry } from "../api/types";
import { useAsync } from "../hooks/useAsync";

interface FilesPanelProps { terminalId: string }

export function FilesPanel({ terminalId }: FilesPanelProps) {
  const [path, setPath] = useState("/");
  const [selected, setSelected] = useState<SshFileEntry | null>(null);
  const [content, setContent] = useState("");
  const loader = useCallback(() => terminalApi.ls(terminalId, path), [terminalId, path]);
  const files = useAsync(loader, [loader]);

  const openEntry = (entry: SshFileEntry) => {
    const fullPath = join(path, entry.name);
    setSelected(entry);
    if (entry.isDir) {
      setPath(fullPath);
      setContent("");
      return;
    }
    terminalApi.readFile(terminalId, fullPath).then((r) => setContent(r.content)).catch((e: unknown) => setContent(e instanceof Error ? e.message : String(e)));
  };

  const save = () => {
    if (!selected || selected.isDir) return;
    void terminalApi.writeFile(terminalId, join(path, selected.name), content).then(() => files.reload());
  };

  const remove = (entry: SshFileEntry) => {
    if (!confirm(`Delete ${entry.name}?`)) return;
    void terminalApi.rm(terminalId, join(path, entry.name)).then(() => files.reload());
  };

  const mkdir = () => {
    const name = prompt("Folder name");
    if (!name) return;
    void terminalApi.mkdir(terminalId, join(path, name)).then(() => files.reload());
  };

  return (
    <div className="grid h-full grid-cols-[320px_1fr] bg-zinc-950">
      <section className="flex min-h-0 flex-col border-r border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 p-2">
          <button type="button" className="cursor-pointer rounded px-2 py-1 text-xs text-zinc-300 hover:bg-white/10" onClick={() => setPath(parent(path))}>Up</button>
          <button type="button" className="cursor-pointer rounded px-2 py-1 text-xs text-zinc-300 hover:bg-white/10" onClick={mkdir}>New folder</button>
          <button type="button" className="ml-auto cursor-pointer rounded p-1 text-zinc-400 hover:bg-white/10" onClick={files.reload}><RefreshCw className="h-4 w-4" /></button>
        </div>
        <div className="border-b border-white/10 px-3 py-2 font-mono text-xs text-zinc-400">{path}</div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {files.error && <div className="p-2 text-xs text-red-300">{files.error}</div>}
          {(files.data?.entries ?? []).map((entry) => (
            <div key={entry.name} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/5">
              <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left" onClick={() => openEntry(entry)}>
                {entry.isDir ? <Folder className="h-4 w-4 text-sky-400" /> : <FileText className="h-4 w-4 text-zinc-400" />}
                <span className="truncate text-sm text-zinc-200">{entry.name}</span>
              </button>
              <button type="button" className="cursor-pointer rounded p-1 text-zinc-500 hover:bg-red-500/10 hover:text-red-300" onClick={() => remove(entry)}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      </section>
      <section className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-zinc-400">
          <span>{selected?.isDir ? "Directory" : selected?.name ?? "Select a file"}</span>
          <button type="button" className="cursor-pointer rounded bg-violet-600 px-2 py-1 text-white disabled:opacity-50" disabled={!selected || selected.isDir} onClick={save}>Save</button>
        </div>
        <textarea className="min-h-0 flex-1 resize-none bg-zinc-950 p-3 font-mono text-xs text-zinc-100 outline-none" value={content} onChange={(e) => setContent(e.target.value)} placeholder="File preview/editor" />
      </section>
    </div>
  );
}

function join(base: string, name: string): string { return base === "/" ? `/${name}` : `${base}/${name}`; }
function parent(value: string): string { return value.replace(/\/[^/]+$/, "") || "/"; }
