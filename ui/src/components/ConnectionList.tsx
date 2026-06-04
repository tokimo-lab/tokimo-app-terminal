import { Monitor, Pencil, Plus, Trash2 } from "lucide-react";
import type { SshTerminalOutput } from "../api/types";

interface ConnectionListProps {
  terminals: SshTerminalOutput[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onEdit: (terminal: SshTerminalOutput) => void;
  onDelete: (terminal: SshTerminalOutput) => void;
}

export function ConnectionList({ terminals, selectedId, loading, onSelect, onCreate, onEdit, onDelete }: ConnectionListProps) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-white/10 bg-zinc-950/70">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-zinc-100">Terminal</div>
          <div className="text-xs text-zinc-500">Local PTY and SSH</div>
        </div>
        <button type="button" className="cursor-pointer rounded-md bg-violet-600 p-2 text-white hover:bg-violet-500" onClick={onCreate} aria-label="New connection">
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {loading && <div className="p-3 text-xs text-zinc-500">Loading…</div>}
        {terminals.map((terminal) => (
          <div key={terminal.id} className={`group mb-1 rounded-lg border px-3 py-2 ${selectedId === terminal.id ? "border-violet-500/60 bg-violet-500/10" : "border-transparent hover:bg-white/5"}`}>
            <button type="button" className="flex w-full cursor-pointer items-start gap-2 text-left" onClick={() => onSelect(terminal.id)}>
              <Monitor className="mt-0.5 h-4 w-4 text-violet-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-zinc-100">{terminal.name}</span>
                <span className="block truncate text-xs text-zinc-500">{terminal.username}@{terminal.host}:{terminal.port}</span>
              </span>
            </button>
            <div className="mt-2 hidden justify-end gap-1 group-hover:flex">
              <button type="button" className="cursor-pointer rounded p-1 text-zinc-400 hover:bg-white/10" onClick={() => onEdit(terminal)}><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" className="cursor-pointer rounded p-1 text-red-300 hover:bg-red-500/10" onClick={() => onDelete(terminal)}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
        {!loading && terminals.length === 0 && <div className="p-3 text-xs text-zinc-500">No SSH connections yet.</div>}
      </div>
    </aside>
  );
}
