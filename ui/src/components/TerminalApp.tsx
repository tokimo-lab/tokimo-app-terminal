import { useCallback, useMemo, useState } from "react";
import { terminalApi } from "../api/client";
import type { CreateSshTerminalInput, SshTerminalOutput } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { ConnectionForm } from "./ConnectionForm";
import { ConnectionList } from "./ConnectionList";
import { TerminalPane } from "./TerminalPane";

export function TerminalApp() {
  const loader = useCallback(() => terminalApi.list(), []);
  const terminals = useAsync(loader, [loader]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SshTerminalOutput | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => terminals.data?.find((item) => item.id === selectedId) ?? null,
    [selectedId, terminals.data],
  );
  const showForm = creating || editing !== null;

  const save = async (input: CreateSshTerminalInput) => {
    setSaving(true);
    try {
      const saved = editing
        ? await terminalApi.update(editing.id, input)
        : await terminalApi.create(input);
      setSelectedId(saved.id);
      setCreating(false);
      setEditing(null);
      terminals.reload();
    } finally {
      setSaving(false);
    }
  };

  const remove = (terminal: SshTerminalOutput) => {
    if (!confirm(`Delete ${terminal.name}?`)) return;
    void terminalApi.delete(terminal.id).then(() => {
      if (selectedId === terminal.id) setSelectedId(null);
      terminals.reload();
    });
  };

  return (
    <div className="flex h-full min-h-0 bg-zinc-950 text-zinc-100">
      <ConnectionList
        terminals={terminals.data ?? []}
        selectedId={selectedId}
        loading={terminals.loading}
        onSelect={setSelectedId}
        onCreate={() => {
          setCreating(true);
          setEditing(null);
        }}
        onEdit={(terminal) => {
          setEditing(terminal);
          setCreating(false);
        }}
        onDelete={remove}
      />
      <div className="relative flex min-w-0 flex-1">
        <TerminalPane selected={selected} />
        {showForm && (
          <div className="absolute inset-y-0 right-0 w-[420px] overflow-auto border-l border-white/10 bg-zinc-950/95 p-4 shadow-2xl">
            <ConnectionForm
              terminal={editing}
              saving={saving}
              onCancel={() => {
                setCreating(false);
                setEditing(null);
              }}
              onSave={save}
            />
          </div>
        )}
        {terminals.error && <div className="absolute bottom-3 left-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{terminals.error}</div>}
      </div>
    </div>
  );
}
