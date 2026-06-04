import { RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { terminalApi } from "../api/client";
import { useAsync } from "../hooks/useAsync";

interface SystemPanelProps { terminalId: string }
type SystemTab = "stats" | "processes" | "storage" | "network";

export function SystemPanel({ terminalId }: SystemPanelProps) {
  const [tab, setTab] = useState<SystemTab>("stats");
  const loader = useCallback(async () => {
    if (tab === "stats") return terminalApi.stats(terminalId);
    if (tab === "processes") return terminalApi.ps(terminalId);
    if (tab === "storage") return terminalApi.df(terminalId);
    return terminalApi.net(terminalId);
  }, [terminalId, tab]);
  const state = useAsync(loader, [loader]);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-white/10 p-2">
        {(["stats", "processes", "storage", "network"] as const).map((item) => (
          <button key={item} type="button" className={`cursor-pointer rounded-md px-3 py-1.5 text-xs capitalize ${tab === item ? "bg-violet-600 text-white" : "text-zinc-400 hover:bg-white/10"}`} onClick={() => setTab(item)}>{item}</button>
        ))}
        <button type="button" className="ml-auto cursor-pointer rounded p-1 text-zinc-400 hover:bg-white/10" onClick={state.reload}><RefreshCw className="h-4 w-4" /></button>
      </div>
      {state.error && <div className="m-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{state.error}</div>}
      {state.loading ? <div className="p-4 text-sm text-zinc-500">Loading…</div> : <JsonView value={state.data} />}
    </div>
  );
}

export function JsonView({ value }: { value: unknown }) {
  return (
    <pre className="min-h-0 flex-1 overflow-auto p-4 text-xs leading-relaxed text-zinc-200">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
