import { Laptop, Server } from "lucide-react";
import { useState } from "react";
import type { SshTerminalOutput } from "../api/types";
import { DockerPanel } from "./DockerPanel";
import { FilesPanel } from "./FilesPanel";
import { SystemPanel } from "./SystemPanel";
import { TerminalTabs } from "./terminal/TerminalTabs";

type Tab = "terminal" | "files" | "system" | "docker";

interface TerminalPaneProps {
  selected: SshTerminalOutput | null;
}

export function TerminalPane({ selected }: TerminalPaneProps) {
  const [tab, setTab] = useState<Tab>("terminal");

  if (!selected) {
    return (
      <main className="flex min-w-0 flex-1 flex-col bg-zinc-950 text-zinc-100">
        <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <Laptop className="h-4 w-4 text-violet-400" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Local terminal</div>
            <div className="truncate text-xs text-zinc-500">
              Select an SSH connection on the left, or work in a local shell.
            </div>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <TerminalTabs scope="terminal-local" />
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
            <div className="truncate text-sm font-semibold">
              {selected.name}
            </div>
            <div className="truncate text-xs text-zinc-500">
              {selected.username}@{selected.host}:{selected.port}
            </div>
          </div>
        </div>
        <nav className="flex rounded-lg border border-white/10 bg-zinc-900 p-1 text-xs">
          {(["terminal", "files", "system", "docker"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`cursor-pointer rounded-md px-3 py-1.5 capitalize ${
                tab === item
                  ? "bg-violet-600 text-white"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* Keep terminal sessions mounted across panel switches. */}
        <div
          className="h-full"
          style={{ display: tab === "terminal" ? "block" : "none" }}
        >
          <TerminalTabs
            scope={`terminal-ssh-${selected.id}`}
            connectionId={selected.id}
          />
        </div>
        {tab === "files" && <FilesPanel terminalId={selected.id} />}
        {tab === "system" && <SystemPanel terminalId={selected.id} />}
        {tab === "docker" && <DockerPanel terminalId={selected.id} />}
      </div>
    </main>
  );
}
