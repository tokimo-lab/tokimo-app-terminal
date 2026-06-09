import { type FormEvent, useEffect, useState } from "react";
import type { CreateSshTerminalInput, SshTerminalOutput } from "../api/types";

interface ConnectionFormProps {
  terminal: SshTerminalOutput | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (input: CreateSshTerminalInput) => Promise<void>;
}

export function ConnectionForm({
  terminal,
  saving,
  onCancel,
  onSave,
}: ConnectionFormProps) {
  const [form, setForm] = useState<CreateSshTerminalInput>(() =>
    toForm(terminal),
  );

  useEffect(() => setForm(toForm(terminal)), [terminal]);

  const set = (
    key: keyof CreateSshTerminalInput,
    value: string | number | undefined,
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave({ ...form, port: Number(form.port) || 22 });
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-white/10 bg-zinc-950/70 p-4"
    >
      <div className="text-sm font-semibold text-zinc-100">
        {terminal ? "Edit SSH connection" : "New SSH connection"}
      </div>
      <label className="grid gap-1 text-xs text-zinc-400">
        Name
        <input
          className="rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          required
        />
      </label>
      <div className="grid grid-cols-[1fr_96px] gap-2">
        <label className="grid gap-1 text-xs text-zinc-400">
          Host
          <input
            className="rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            required
          />
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Port
          <input
            className="rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            type="number"
            value={form.port ?? 22}
            onChange={(e) => set("port", Number(e.target.value))}
          />
        </label>
      </div>
      <label className="grid gap-1 text-xs text-zinc-400">
        Username
        <input
          className="rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          value={form.username}
          onChange={(e) => set("username", e.target.value)}
          required
        />
      </label>
      <label className="grid gap-1 text-xs text-zinc-400">
        Auth method
        <select
          className="rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          value={form.authMethod ?? "password"}
          onChange={(e) => set("authMethod", e.target.value)}
        >
          <option value="password">Password</option>
          <option value="private_key">Private key</option>
        </select>
      </label>
      {(form.authMethod ?? "password") === "password" ? (
        <label className="grid gap-1 text-xs text-zinc-400">
          Password {terminal ? "(leave blank to keep)" : ""}
          <input
            className="rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            type="password"
            value={form.password ?? ""}
            onChange={(e) => set("password", e.target.value || undefined)}
            required={!terminal}
          />
        </label>
      ) : (
        <label className="grid gap-1 text-xs text-zinc-400">
          Private key {terminal ? "(leave blank to keep)" : ""}
          <textarea
            className="min-h-28 rounded-md border border-white/10 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100"
            value={form.privateKey ?? ""}
            onChange={(e) => set("privateKey", e.target.value || undefined)}
            required={!terminal}
          />
        </label>
      )}
      <label className="grid gap-1 text-xs text-zinc-400">
        Startup command
        <input
          className="rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          value={form.startupCommand ?? ""}
          onChange={(e) => set("startupCommand", e.target.value || undefined)}
        />
      </label>
      <label className="grid gap-1 text-xs text-zinc-400">
        Notes
        <textarea
          className="rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          value={form.notes ?? ""}
          onChange={(e) => set("notes", e.target.value || undefined)}
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="cursor-pointer rounded-md px-3 py-2 text-sm text-zinc-300 hover:bg-white/10"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="cursor-pointer rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500"
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function toForm(terminal: SshTerminalOutput | null): CreateSshTerminalInput {
  return {
    name: terminal?.name ?? "",
    host: terminal?.host ?? "",
    port: terminal?.port ?? 22,
    username: terminal?.username ?? "root",
    authMethod: terminal?.authMethod ?? "password",
    startupCommand: terminal?.startupCommand ?? undefined,
    notes: terminal?.notes ?? undefined,
  };
}
