/**
 * Docker management panel for SSH terminal.
 * Sub-tabs: 容器 / 镜像 / 网络 / 存储卷 / 监控.
 * All presented in table format with full CRUD actions.
 */
import {
  Activity,
  ArrowLeft,
  Container,
  Eraser,
  HardDrive,
  Image,
  Network,
  ScrollText,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import XTermLogViewer from "@/apps/downloads/components/XTermLogViewer";
import { api } from "@/generated/rust-api";
import type { DockerContainerEntry } from "@/generated/rust-types/DockerContainerEntry";
import type { DockerImageEntry } from "@/generated/rust-types/DockerImageEntry";
import type { DockerNetworkEntry } from "@/generated/rust-types/DockerNetworkEntry";
import type { DockerStatsEntry } from "@/generated/rust-types/DockerStatsEntry";
import type { DockerVolumeEntry } from "@/generated/rust-types/DockerVolumeEntry";
import DockerContainerTable from "./DockerContainerTable";
import DockerImageTable from "./DockerImageTable";
import DockerInspectView from "./DockerInspectView";
import DockerNetworkTable from "./DockerNetworkTable";
import DockerVolumeTable from "./DockerVolumeTable";
import { type SshColumn, SshDataTable } from "./SshDataTable";

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
      <div className="flex items-center justify-center h-full text-xs text-fg-muted gap-2">
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
            className="p-0.5 text-fg-muted hover:text-fg-secondary transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
          </button>
          <ScrollText className="h-3 w-3 text-fg-muted" />
          <span className="text-xs text-fg-secondary truncate">
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
        <button
          type="button"
          onClick={handleSystemPrune}
          className="flex items-center gap-0.5 text-[11px] text-fg-muted hover:text-amber-400 transition-colors px-1 cursor-pointer"
          title="系统清理 (docker system prune)"
        >
          <Eraser className="h-3 w-3" />
          清理
        </button>
      </div>

      {/* Prune feedback */}
      {pruneMsg && (
        <div className="px-3 py-1 text-[11px] text-green-400 bg-green-400/5 border-b border-black/[0.08] dark:border-zinc-800/60 shrink-0">
          {pruneMsg}
        </div>
      )}

      {/* Table content */}
      <div className="flex-1 min-h-0 overflow-hidden">
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
          <DockerStatsTable
            stats={stats}
            loading={loading}
            onRefresh={fetchStats}
          />
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
          : "text-fg-muted hover:text-fg-secondary"
      }`}
    >
      {icon}
      {label}
      {count > 0 && (
        <span className="text-[9px] text-fg-muted ml-0.5">{count}</span>
      )}
    </button>
  );
}

/** Inline stats table — read-only, no actions */
function DockerStatsTable({
  stats,
  loading,
  onRefresh,
}: {
  stats: DockerStatsEntry[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const columns = useMemo<SshColumn<DockerStatsEntry>[]>(
    () => [
      {
        key: "name",
        header: "CONTAINER",
        width: "minmax(120px,1.2fr)",
        sortable: true,
        compare: (a, b) => a.name.localeCompare(b.name),
        cellClassName: "px-2 truncate text-fg-primary",
        render: (s) => s.name,
      },
      {
        key: "cpu",
        header: "CPU %",
        width: "80px",
        align: "right",
        sortable: true,
        compare: (a, b) =>
          Number.parseFloat(a.cpuPercent) - Number.parseFloat(b.cpuPercent),
        render: (s) => <CpuBadge value={s.cpuPercent} />,
      },
      {
        key: "memUsage",
        header: "MEM USAGE",
        width: "minmax(120px,1fr)",
        align: "right",
        cellClassName: "px-2 text-right tabular-nums text-fg-muted",
        render: (s) => s.memUsage,
      },
      {
        key: "mem",
        header: "MEM %",
        width: "80px",
        align: "right",
        sortable: true,
        compare: (a, b) =>
          Number.parseFloat(a.memPercent) - Number.parseFloat(b.memPercent),
        render: (s) => <MemBadge value={s.memPercent} />,
      },
      {
        key: "netIo",
        header: "NET I/O",
        width: "minmax(100px,1fr)",
        align: "right",
        cellClassName: "px-2 text-right tabular-nums text-fg-muted",
        render: (s) => s.netIo,
      },
      {
        key: "blockIo",
        header: "BLOCK I/O",
        width: "minmax(100px,1fr)",
        align: "right",
        cellClassName: "px-2 text-right tabular-nums text-fg-muted",
        render: (s) => s.blockIo,
      },
      {
        key: "pids",
        header: "PIDS",
        width: "70px",
        align: "right",
        sortable: true,
        compare: (a, b) => Number(a.pids) - Number(b.pids),
        cellClassName: "px-2 text-right tabular-nums text-fg-muted",
        render: (s) => s.pids,
      },
    ],
    [],
  );

  return (
    <SshDataTable
      items={stats}
      columns={columns}
      getRowKey={(s) => s.containerId}
      loading={loading}
      onRefresh={onRefresh}
      defaultSortKey="cpu"
      defaultSortDir="desc"
      emptyText="无运行中的容器"
    />
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
    n > 80 ? "text-red-400" : n > 50 ? "text-amber-400" : "text-fg-muted";
  return <span className={color}>{value}</span>;
}

/** xterm.js-based docker log viewer — supports Ctrl+C/V copy-paste */
function DockerLogTerminal({ logs }: { logs: string }) {
  const lines = useMemo(() => logs.split("\n"), [logs]);
  return <XTermLogViewer lines={lines} height="100%" minHeight={0} />;
}
