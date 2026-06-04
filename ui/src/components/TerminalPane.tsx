import { WebTerminal } from "@tokimo/terminal";
import { Laptop, Server } from "lucide-react";
import { useMemo, useState } from "react";
import { wsUrl } from "../api/client";
import type { SshTerminalOutput } from "../api/types";
import { DockerPanel } from "./DockerPanel";
import { FilesPanel } from "./FilesPanel";
import { SystemPanel } from "./SystemPanel";

type Tab = "terminal" | "files" | "system" | "docker";

interface TerminalPaneProps {
  selected: SshTerminalOutput | null;
}

export function TerminalPane({ selected }: TerminalPaneProps) {
  const [tab, setTab] = useState<Tab>("terminal");
  const sshSessionId = useMemo(() => crypto.randomUUID(), [selected?.id]);
  const localSessionId = useMemo(() => crypto.randomUUID(), []);

  if (!selected) {
    return (
      <main className="flex min-w-0 flex-1 flex-col bg-zinc-950 text-zinc-100">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-500">
          <Laptop className="h-10 w-10" />
          <div className="text-sm">Select an SSH connection, or use the local terminal below.</div>
          <div className="h-80 w-[min(900px,80%)] overflow-hidden rounded-xl border border-white/10 bg-black">
            <WebTerminal wsUrl={wsUrl(`/local-ws?session_id=${encodeURIComponent(localSessionId)}`)} borderless minHeight={320} />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Server className="h-4 w-4 text-violet-400" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{selected.name}</div>
            <div className="truncate text-xs text-zinc-500">{selected.username}@{selected.host}:{selected.port}</div>
          </div>
        </div>
        <nav className="flex rounded-lg border border-white/10 bg-zinc-900 p-1 text-xs">
          {(["terminal", "files", "system", "docker"] as const).map((item) => (
            <button key={item} type="button" className={`cursor-pointer rounded-md px-3 py-1.5 capitalize ${tab === item ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-zinc-100"}`} onClick={() => setTab(item)}>
              {item}
            </button>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "terminal" && (
          <WebTerminal wsUrl={wsUrl(`/connections/ws?id=${encodeURIComponent(selected.id)}&session_id=${encodeURIComponent(sshSessionId)}`)} borderless minHeight={500} />
        )}
        {tab === "files" && <FilesPanel terminalId={selected.id} />}
        {tab === "system" && <SystemPanel terminalId={selected.id} />}
        {tab === "docker" && <DockerPanel terminalId={selected.id} />}
      </div>
    </main>
  );
}
