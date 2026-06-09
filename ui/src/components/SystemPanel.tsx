import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { NetworkPanel } from "./system/NetworkPanel";
import { ProcessList } from "./system/ProcessList";
import { StatsView } from "./system/StatsView";
import { StoragePanel } from "./system/StoragePanel";

interface SystemPanelProps {
  terminalId: string;
}

type SystemTab = "stats" | "processes" | "storage" | "network";

export function SystemPanel({ terminalId }: SystemPanelProps) {
  const [tab, setTab] = useState<SystemTab>("stats");
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-white/10 p-2">
        {(["stats", "processes", "storage", "network"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`cursor-pointer rounded-md px-3 py-1.5 text-xs capitalize ${
              tab === item
                ? "bg-violet-600 text-white"
                : "text-zinc-400 hover:bg-white/10"
            }`}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
        <button
          type="button"
          className="ml-auto cursor-pointer rounded p-1 text-zinc-400 hover:bg-white/10"
          onClick={() => setRefreshToken((v) => v + 1)}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {tab === "stats" && (
        <StatsView terminalId={terminalId} refreshToken={refreshToken} />
      )}
      {tab === "processes" && (
        <ProcessList terminalId={terminalId} refreshToken={refreshToken} />
      )}
      {tab === "storage" && (
        <StoragePanel terminalId={terminalId} refreshToken={refreshToken} />
      )}
      {tab === "network" && (
        <NetworkPanel terminalId={terminalId} refreshToken={refreshToken} />
      )}
    </div>
  );
}
