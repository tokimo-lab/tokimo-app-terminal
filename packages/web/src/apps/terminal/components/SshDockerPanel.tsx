/**
 * Docker management panel for SSH terminal.
 * Sub-tabs: 容器 / 镜像 / 网络 / 存储卷 / 监控.
 * All presented in table format with full CRUD actions.
 */
import { LoadingOutlined } from "@tokiomo/components";
import {
  Activity,
  ArrowLeft,
  Container,
  Eraser,
  HardDrive,
  Image,
  Network,
  RefreshCw,
  ScrollText,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../generated/rust-api";
import type { DockerContainerEntry } from "../../generated/rust-types/DockerContainerEntry";
import type { DockerImageEntry } from "../../generated/rust-types/DockerImageEntry";
import type { DockerNetworkEntry } from "../../generated/rust-types/DockerNetworkEntry";
import type { DockerStatsEntry } from "../../generated/rust-types/DockerStatsEntry";
import type { DockerVolumeEntry } from "../../generated/rust-types/DockerVolumeEntry";
import XTermLogViewer from "../dashboard/XTermLogViewer";
import DockerContainerTable from "./DockerContainerTable";
import DockerImageTable from "./DockerImageTable";
import DockerInspectView from "./DockerInspectView";
import DockerNetworkTable from "./DockerNetworkTable";
import DockerVolumeTable from "./DockerVolumeTable";

interface SshDockerPanelProps {
  terminalId: string;
  connected: boolean;
}

type SubTab = "containers" | "images" | "networks" | "volumes" | "stats";

/** Overlay views on top of the main table */
type OverlayView =
  | { kind: "logs"; name: string; logs: string }
  | { kind: "inspect"; containerId: string };

export default function SshDockerPanel({
  terminalId,
  connected,
}: SshDockerPanelProps) {
  const [subTab, setSubTab] = useState<SubTab>("containers");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [containers, setContainers] = useState<DockerContainerEntry[]>([]);
  const [images, setImages] = useState<DockerImageEntry[]>([]);
  const [networks, setNetworks] = useState<DockerNetworkEntry[]>([]);
  const [volumes, setVolumes] = useState<DockerVolumeEntry[]>([]);
  const [stats, setStats] = useState<DockerStatsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [overlay, setOverlay] = useState<OverlayView | null>(null);
  const [pruneMsg, setPruneMsg] = useState<string | null>(null);

  // ── Fetch helpers ──

  const fetchContainers = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const resp = await api.sshTerminal.dockerPs.fetch({ id: terminalId });
      setAvailable(resp.available);
      setContainers(resp.containers);
    } catch {
      setContainers([]);
    } finally {
      setLoading(false);
    }
  }, [terminalId, connected]);

  const fetchImages = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const resp = await api.sshTerminal.dockerImages.fetch({ id: terminalId });
      setImages(resp.images);
    } catch {
      setImages([]);
    } finally {
      setLoading(false);
    }
  }, [terminalId, connected]);

  const fetchNetworks = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const resp = await api.sshTerminal.dockerNetworks.fetch({
        id: terminalId,
      });
      setNetworks(resp.networks);
    } catch {
      setNetworks([]);
    } finally {
      setLoading(false);
    }
  }, [terminalId, connected]);

  const fetchVolumes = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const resp = await api.sshTerminal.dockerVolumes.fetch({
        id: terminalId,
      });
      setVolumes(resp.volumes);
    } catch {
      setVolumes([]);
    } finally {
      setLoading(false);
    }
  }, [terminalId, connected]);

  const fetchStats = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const resp = await api.sshTerminal.dockerStats.fetch({
        id: terminalId,
      });
      setStats(resp.stats);
    } catch {
      setStats([]);
    } finally {
      setLoading(false);
    }
  }, [terminalId, connected]);

  // Initial load
  useEffect(() => {
    if (!connected) return;
    fetchContainers();
  }, [connected, fetchContainers]);

  // Lazy load on tab switch
  useEffect(() => {
    if (!connected) return;
    if (subTab === "images" && images.length === 0) fetchImages();
    if (subTab === "networks" && networks.length === 0) fetchNetworks();
    if (subTab === "volumes" && volumes.length === 0) fetchVolumes();
    if (subTab === "stats") fetchStats();
  }, [
    connected,
    subTab,
    images.length,
    networks.length,
    volumes.length,
    fetchImages,
    fetchNetworks,
    fetchVolumes,
    fetchStats,
  ]);

  const refreshCurrent = useCallback(() => {
    if (subTab === "containers") fetchContainers();
    else if (subTab === "images") fetchImages();
    else if (subTab === "networks") fetchNetworks();
    else if (subTab === "volumes") fetchVolumes();
    else fetchStats();
  }, [
    subTab,
    fetchContainers,
    fetchImages,
    fetchNetworks,
    fetchVolumes,
    fetchStats,
  ]);

  // ── Actions ──

  const handleViewLogs = useCallback(
    async (containerId: string, name: string) => {
      try {
        const resp = await api.sshTerminal.dockerLogs.mutate({
          id: terminalId,
          containerId,
          tail: 200,
        });
        setOverlay({ kind: "logs", name, logs: resp.logs });
      } catch {
        setOverlay({ kind: "logs", name, logs: "无法获取日志" });
      }
    },
    [terminalId],
  );

  const handleInspect = useCallback((containerId: string) => {
    setOverlay({ kind: "inspect", containerId });
  }, []);

  const handleSystemPrune = useCallback(async () => {
    try {
      const resp = await api.sshTerminal.dockerPruneSystem.mutate({
        id: terminalId,
      });
      setPruneMsg(resp.output);
      setTimeout(() => setPruneMsg(null), 5000);
      // Refresh all data
      fetchContainers();
      fetchImages();
      fetchNetworks();
      fetchVolumes();
    } catch {
      // ignore
    }
  }, [terminalId, fetchContainers, fetchImages, fetchNetworks, fetchVolumes]);

  // ── Docker not available ──
  if (available === false) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-zinc-500 dark:text-zinc-500 gap-2">
        <Container className="h-4 w-4" />
        远程主机未安装 Docker
      </div>
    );
  }

  // ── Overlay: Logs ──
  if (overlay?.kind === "logs") {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1 border-b border-black/[0.08] dark:border-zinc-800/60 shrink-0">
          <button
            type="button"
            onClick={() => setOverlay(null)}
            className="p-0.5 text-zinc-500 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
          </button>
          <ScrollText className="h-3 w-3 text-zinc-500 dark:text-zinc-500" />
          <span className="text-xs text-zinc-700 dark:text-zinc-300 truncate">
            {overlay.name} 日志
          </span>
        </div>
        <DockerLogTerminal logs={overlay.logs} />
      </div>
    );
  }

  // ── Overlay: Inspect ──
  if (overlay?.kind === "inspect") {
    return (
      <DockerInspectView
        terminalId={terminalId}
        containerId={overlay.containerId}
        onBack={() => setOverlay(null)}
      />
    );
  }

  // ── Main table view ──
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-black/[0.08] dark:border-zinc-800/60 shrink-0">
        <div className="flex items-center gap-1">
          <TabPill
            active={subTab === "containers"}
            onClick={() => setSubTab("containers")}
            icon={<Container className="h-3 w-3" />}
            label="容器"
            count={containers.length}
          />
          <TabPill
            active={subTab === "images"}
            onClick={() => setSubTab("images")}
            icon={<Image className="h-3 w-3" />}
            label="镜像"
            count={images.length}
          />
          <TabPill
            active={subTab === "networks"}
            onClick={() => setSubTab("networks")}
            icon={<Network className="h-3 w-3" />}
            label="网络"
            count={networks.length}
          />
          <TabPill
            active={subTab === "volumes"}
            onClick={() => setSubTab("volumes")}
            icon={<HardDrive className="h-3 w-3" />}
            label="存储卷"
            count={volumes.length}
          />
          <TabPill
            active={subTab === "stats"}
            onClick={() => setSubTab("stats")}
            icon={<Activity className="h-3 w-3" />}
            label="监控"
            count={0}
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleSystemPrune}
            className="flex items-center gap-0.5 text-[10px] text-zinc-500 hover:text-amber-400 transition-colors px-1"
            title="系统清理 (docker system prune)"
          >
            <Eraser className="h-2.5 w-2.5" />
            清理
          </button>
          <button
            type="button"
            onClick={refreshCurrent}
            className="p-0.5 text-zinc-500 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 transition-colors"
            title="刷新"
          >
            {loading ? (
              <LoadingOutlined className="h-3 w-3" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>

      {/* Prune feedback */}
      {pruneMsg && (
        <div className="px-3 py-1 text-[11px] text-green-400 bg-green-400/5 border-b border-black/[0.08] dark:border-zinc-800/60 shrink-0">
          {pruneMsg}
        </div>
      )}

      {/* Table content */}
      <div className="flex-1 overflow-y-auto overflow-x-auto">
        {subTab === "containers" && (
          <DockerContainerTable
            terminalId={terminalId}
            containers={containers}
            loading={loading}
            onRefresh={fetchContainers}
            onViewLogs={handleViewLogs}
            onInspect={handleInspect}
          />
        )}
        {subTab === "images" && (
          <DockerImageTable
            terminalId={terminalId}
            images={images}
            loading={loading}
            onRefresh={fetchImages}
          />
        )}
        {subTab === "networks" && (
          <DockerNetworkTable
            terminalId={terminalId}
            networks={networks}
            loading={loading}
            onRefresh={fetchNetworks}
          />
        )}
        {subTab === "volumes" && (
          <DockerVolumeTable
            terminalId={terminalId}
            volumes={volumes}
            loading={loading}
            onRefresh={fetchVolumes}
          />
        )}
        {subTab === "stats" && (
          <DockerStatsTable stats={stats} loading={loading} />
        )}
      </div>
    </div>
  );
}

function TabPill({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded transition-colors ${
        active
          ? "text-[var(--accent-text)] bg-[var(--accent)]/10"
          : "text-zinc-500 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
      }`}
    >
      {icon}
      {label}
      {count > 0 && (
        <span className="text-[9px] text-zinc-500 dark:text-zinc-500 ml-0.5">
          {count}
        </span>
      )}
    </button>
  );
}

/** Inline stats table — read-only, no actions */
function DockerStatsTable({
  stats,
  loading,
}: {
  stats: DockerStatsEntry[];
  loading: boolean;
}) {
  if (loading && stats.length === 0) {
    return (
      <div className="text-zinc-500 dark:text-zinc-500 text-xs px-3 py-2">
        加载中...
      </div>
    );
  }
  if (stats.length === 0) {
    return (
      <div className="text-zinc-500 dark:text-zinc-500 text-xs px-3 py-2">
        无运行中的容器
      </div>
    );
  }

  return (
    <table className="w-full border-collapse text-xs font-mono">
      <thead className="sticky top-0 bg-white dark:bg-zinc-900 z-10">
        <tr className="text-zinc-700 dark:text-zinc-300">
          <th className="px-2 py-1 text-left font-normal">CONTAINER</th>
          <th className="px-2 py-1 text-right font-normal">CPU %</th>
          <th className="px-2 py-1 text-right font-normal">MEM USAGE</th>
          <th className="px-2 py-1 text-right font-normal">MEM %</th>
          <th className="px-2 py-1 text-right font-normal">NET I/O</th>
          <th className="px-2 py-1 text-right font-normal">BLOCK I/O</th>
          <th className="px-2 py-1 text-right font-normal">PIDS</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s) => (
          <tr
            key={s.containerId}
            className="text-zinc-700 dark:text-zinc-300 hover:bg-black/[0.04] dark:hover:bg-zinc-800/50"
          >
            <td className="px-2 py-0.5 text-zinc-800 dark:text-zinc-200 truncate max-w-32">
              {s.name}
            </td>
            <td className="px-2 py-0.5 text-right tabular-nums">
              <CpuBadge value={s.cpuPercent} />
            </td>
            <td className="px-2 py-0.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
              {s.memUsage}
            </td>
            <td className="px-2 py-0.5 text-right tabular-nums">
              <MemBadge value={s.memPercent} />
            </td>
            <td className="px-2 py-0.5 text-right tabular-nums text-zinc-500 dark:text-zinc-400 text-[10px]">
              {s.netIo}
            </td>
            <td className="px-2 py-0.5 text-right tabular-nums text-zinc-500 dark:text-zinc-400 text-[10px]">
              {s.blockIo}
            </td>
            <td className="px-2 py-0.5 text-right tabular-nums text-zinc-500 dark:text-zinc-500">
              {s.pids}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CpuBadge({ value }: { value: string }) {
  const n = Number.parseFloat(value);
  const color =
    n > 80 ? "text-red-400" : n > 50 ? "text-amber-400" : "text-green-400";
  return <span className={color}>{value}</span>;
}

function MemBadge({ value }: { value: string }) {
  const n = Number.parseFloat(value);
  const color =
    n > 80
      ? "text-red-400"
      : n > 50
        ? "text-amber-400"
        : "text-zinc-600 dark:text-zinc-300";
  return <span className={color}>{value}</span>;
}

/** xterm.js-based docker log viewer — supports Ctrl+C/V copy-paste */
function DockerLogTerminal({ logs }: { logs: string }) {
  const lines = useMemo(() => logs.split("\n"), [logs]);
  return <XTermLogViewer lines={lines} height="100%" minHeight={0} />;
}
