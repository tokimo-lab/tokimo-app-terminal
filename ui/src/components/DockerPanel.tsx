import { Modal, useToast } from "@tokimo/ui";
import { Eraser, RefreshCw } from "lucide-react";
import { useState } from "react";
import { terminalApi } from "../api/client";
import { ContainerTable } from "./docker/ContainerTable";
import { ImageTable } from "./docker/ImageTable";
import { NetworkTable } from "./docker/NetworkTable";
import { StatsTable } from "./docker/StatsTable";
import { VolumeTable } from "./docker/VolumeTable";

interface DockerPanelProps {
  terminalId: string;
}

type DockerTab = "containers" | "images" | "networks" | "volumes" | "stats";

const TABS: DockerTab[] = [
  "containers",
  "images",
  "networks",
  "volumes",
  "stats",
];

export function DockerPanel({ terminalId }: DockerPanelProps) {
  const toast = useToast();
  const [tab, setTab] = useState<DockerTab>("containers");
  const [refreshKey, setRefreshKey] = useState(0);

  const pruneSystem = () => {
    Modal.confirm({
      title: "Prune system",
      content:
        "Remove all unused containers, networks, images and build cache?",
      variant: "danger",
      okText: "Prune",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const resp = await terminalApi.dockerPruneSystem(terminalId);
          Modal.confirm({
            title: "Prune result",
            content: (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-zinc-300">
                {resp.output.trim() || "Nothing to prune"}
              </pre>
            ),
            okText: "OK",
          });
          setRefreshKey((k) => k + 1);
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Prune failed");
        }
      },
    });
  };

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-white/10 p-2">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            className={`cursor-pointer rounded-md px-3 py-1.5 text-xs capitalize ${tab === item ? "bg-violet-600 text-white" : "text-zinc-400 hover:bg-white/10"}`}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
        <button
          type="button"
          className="ml-auto flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-white/10 hover:text-amber-400"
          onClick={pruneSystem}
          title="docker system prune"
        >
          <Eraser className="h-4 w-4" />
          Prune system
        </button>
        <button
          type="button"
          className="cursor-pointer rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
          onClick={() => setRefreshKey((k) => k + 1)}
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "containers" ? (
          <ContainerTable terminalId={terminalId} refreshKey={refreshKey} />
        ) : null}
        {tab === "images" ? (
          <ImageTable terminalId={terminalId} refreshKey={refreshKey} />
        ) : null}
        {tab === "networks" ? (
          <NetworkTable terminalId={terminalId} refreshKey={refreshKey} />
        ) : null}
        {tab === "volumes" ? (
          <VolumeTable terminalId={terminalId} refreshKey={refreshKey} />
        ) : null}
        {tab === "stats" ? (
          <StatsTable terminalId={terminalId} refreshKey={refreshKey} />
        ) : null}
      </div>
    </div>
  );
}
