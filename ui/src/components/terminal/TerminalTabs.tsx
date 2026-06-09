import { WebTerminal } from "@tokimo/terminal";
import { Plus, X } from "lucide-react";
import { useCallback, useState } from "react";
import { wsUrl } from "../../api/client";

interface TerminalTabsProps {
  /** SSH connection id, or undefined for a local PTY shell. */
  connectionId?: string;
  /** Stable key prefix used to scope WebTerminal sessionStorage keys. */
  scope: string;
}

interface TermTab {
  id: number;
  title: string;
}

/**
 * Multi-session terminal strip. Each tab is an independent WebTerminal bound to
 * its own backend PTY/SSH session (persisted via a unique sessionStorageKey).
 * Inactive tabs stay mounted (hidden) so their WebSocket sessions keep running.
 */
export function TerminalTabs({ connectionId, scope }: TerminalTabsProps) {
  const [tabs, setTabs] = useState<TermTab[]>([{ id: 0, title: "Shell 1" }]);
  const [activeId, setActiveId] = useState(0);
  const [nextId, setNextId] = useState(1);

  const addTab = useCallback(() => {
    setTabs((prev) => {
      const tab: TermTab = { id: nextId, title: `Shell ${prev.length + 1}` };
      return [...prev, tab];
    });
    setActiveId(nextId);
    setNextId((n) => n + 1);
  }, [nextId]);

  const closeTab = useCallback((id: number) => {
    setTabs((prev) => {
      if (prev.length === 1) return prev;
      const next = prev.filter((t) => t.id !== id);
      setActiveId((cur) => (cur === id ? next[next.length - 1].id : cur));
      return next;
    });
  }, []);

  const urlFor = (tabId: number): string => {
    const key = `${scope}-${tabId}`;
    return connectionId
      ? wsUrl(`/connections/ws?id=${encodeURIComponent(connectionId)}`)
      : wsUrl(`/local-ws?label=${encodeURIComponent(key)}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <div className="flex items-center gap-1 border-b border-white/10 bg-zinc-950 px-2 py-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`group flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
              tab.id === activeId
                ? "bg-violet-600/20 text-violet-200"
                : "text-zinc-400 hover:bg-white/5"
            }`}
          >
            <button
              type="button"
              className="cursor-pointer"
              onClick={() => setActiveId(tab.id)}
            >
              {tab.title}
            </button>
            {tabs.length > 1 && (
              <button
                type="button"
                className="cursor-pointer rounded p-0.5 opacity-0 hover:bg-white/10 group-hover:opacity-100"
                onClick={() => closeTab(tab.id)}
                aria-label="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="ml-1 cursor-pointer rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
          onClick={addTab}
          aria-label="New shell"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ visibility: tab.id === activeId ? "visible" : "hidden" }}
          >
            <WebTerminal
              wsUrl={urlFor(tab.id)}
              sessionStorageKey={`${scope}-${tab.id}`}
              borderless
              height="100%"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
