/**
 * Remote network visualization panel for SSH terminal.
 * Fetches network info via /api/apps/terminal/connections/{id}/net endpoint.
 * Displays interfaces, listening sockets, active connections, and routes.
 */
import { Network } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { terminalApi } from "../api/client";
import type {
  SshConnectionEntry,
  SshListeningSocketEntry,
  SshNetworkInterfaceEntry,
  SshRouteEntry,
} from "../api/types";
import { type SshColumn, SshDataTable } from "./SshDataTable";
import { formatBytes } from "./ssh-terminal-utils";

interface SshNetworkPanelProps {
  terminalId: string;
  connected: boolean;
}

type SubTab = "interfaces" | "listening" | "connections" | "routes";

export default function SshNetworkPanel({
  terminalId,
  connected,
}: SshNetworkPanelProps) {
  const [interfaces, setInterfaces] = useState<SshNetworkInterfaceEntry[]>([]);
  const [listening, setListening] = useState<SshListeningSocketEntry[]>([]);
  const [connections, setConnections] = useState<SshConnectionEntry[]>([]);
  const [routes, setRoutes] = useState<SshRouteEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [subTab, setSubTab] = useState<SubTab>("interfaces");

  const fetchNetwork = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const resp = await terminalApi.net(terminalId);
      setInterfaces(resp.interfaces);
      setListening(resp.listening);
      setConnections(resp.connections);
      setRoutes(resp.routes);
    } catch {
      setInterfaces([]);
      setListening([]);
      setConnections([]);
      setRoutes([]);
    } finally {
      setLoading(false);
    }
  }, [terminalId, connected]);

  useEffect(() => {
    if (!connected) return;
    fetchNetwork();
  }, [connected, fetchNetwork]);

  const toolbarLeft = (
    <div className="flex items-center gap-1">
      <SubTabButton
        active={subTab === "interfaces"}
        onClick={() => setSubTab("interfaces")}
        label={`接口 (${interfaces.length})`}
      />
      <SubTabButton
        active={subTab === "listening"}
        onClick={() => setSubTab("listening")}
        label={`监听 (${listening.length})`}
      />
      <SubTabButton
        active={subTab === "connections"}
        onClick={() => setSubTab("connections")}
        label={`连接 (${connections.length})`}
      />
      <SubTabButton
        active={subTab === "routes"}
        onClick={() => setSubTab("routes")}
        label={`路由 (${routes.length})`}
      />
    </div>
  );

  if (subTab === "interfaces") {
    return (
      <InterfaceView
        interfaces={interfaces}
        loading={loading}
        onRefresh={fetchNetwork}
        toolbarLeft={toolbarLeft}
      />
    );
  }
  if (subTab === "listening") {
    return (
      <ListeningView
        sockets={listening}
        loading={loading}
        onRefresh={fetchNetwork}
        toolbarLeft={toolbarLeft}
      />
    );
  }
  if (subTab === "connections") {
    return (
      <ConnectionView
        connections={connections}
        loading={loading}
        onRefresh={fetchNetwork}
        toolbarLeft={toolbarLeft}
      />
    );
  }
  return (
    <RouteView
      routes={routes}
      loading={loading}
      onRefresh={fetchNetwork}
      toolbarLeft={toolbarLeft}
    />
  );
}

function SubTabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
        active
          ? "text-fg-primary bg-black/[0.08] dark:bg-zinc-700/60"
          : "text-fg-muted hover:text-fg-secondary"
      }`}
    >
      {label}
    </button>
  );
}

interface SubViewProps {
  loading: boolean;
  onRefresh: () => void;
  toolbarLeft: React.ReactNode;
}

function InterfaceView({
  interfaces,
  loading,
  onRefresh,
  toolbarLeft,
}: SubViewProps & { interfaces: SshNetworkInterfaceEntry[] }) {
  const columns = useMemo<SshColumn<SshNetworkInterfaceEntry>[]>(
    () => [
      {
        key: "name",
        header: "接口",
        width: "140px",
        sortable: true,
        compare: (a, b) => a.name.localeCompare(b.name),
        render: (i) => (
          <div className="flex items-center gap-1.5 min-w-0">
            <Network className="h-3 w-3 shrink-0 text-[var(--accent-text)]" />
            <span className="text-fg-primary truncate">{i.name}</span>
          </div>
        ),
      },
      {
        key: "state",
        header: "状态",
        width: "70px",
        sortable: true,
        compare: (a, b) => Number(a.isUp) - Number(b.isUp),
        render: (i) => (
          <span
            className={`inline-flex items-center gap-1 ${
              i.isUp ? "text-emerald-400" : "text-fg-muted"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                i.isUp ? "bg-emerald-400" : "bg-zinc-400 dark:bg-zinc-600"
              }`}
            />
            {i.isUp ? "UP" : "DOWN"}
          </span>
        ),
      },
      {
        key: "ip",
        header: "IP 地址",
        width: "minmax(140px,1.5fr)",
        render: (i) => (
          <span className="truncate">
            {i.ipAddresses.length > 0 ? i.ipAddresses.join(", ") : "—"}
          </span>
        ),
      },
      {
        key: "mac",
        header: "MAC",
        width: "140px",
        cellClassName: "px-2 truncate text-fg-muted",
        render: (i) => i.macAddress || "—",
      },
      {
        key: "mtu",
        header: "MTU",
        width: "70px",
        align: "right",
        sortable: true,
        compare: (a, b) => (a.mtu ?? 0) - (b.mtu ?? 0),
        render: (i) => i.mtu ?? "—",
      },
      {
        key: "rx",
        header: "RX",
        width: "90px",
        align: "right",
        sortable: true,
        compare: (a, b) => Number(a.rxBytes) - Number(b.rxBytes),
        render: (i) => formatBytes(i.rxBytes),
      },
      {
        key: "tx",
        header: "TX",
        width: "90px",
        align: "right",
        sortable: true,
        compare: (a, b) => Number(a.txBytes) - Number(b.txBytes),
        render: (i) => formatBytes(i.txBytes),
      },
    ],
    [],
  );
  return (
    <SshDataTable
      items={interfaces}
      columns={columns}
      getRowKey={(i) => i.name}
      loading={loading}
      onRefresh={onRefresh}
      toolbarLeft={toolbarLeft}
      emptyText="无网络接口"
    />
  );
}

function ListeningView({
  sockets,
  loading,
  onRefresh,
  toolbarLeft,
}: SubViewProps & { sockets: SshListeningSocketEntry[] }) {
  const columns = useMemo<SshColumn<SshListeningSocketEntry>[]>(
    () => [
      {
        key: "protocol",
        header: "协议",
        width: "80px",
        sortable: true,
        compare: (a, b) => a.protocol.localeCompare(b.protocol),
        render: (s) => <ProtocolBadge protocol={s.protocol} />,
      },
      {
        key: "local",
        header: "本地地址",
        width: "minmax(180px,1.5fr)",
        sortable: true,
        compare: (a, b) => a.localAddress.localeCompare(b.localAddress),
        cellClassName: "px-2 truncate font-mono",
        render: (s) => s.localAddress,
      },
      {
        key: "process",
        header: "进程",
        width: "minmax(160px,1fr)",
        sortable: true,
        compare: (a, b) => a.process.localeCompare(b.process),
        cellClassName: "px-2 truncate text-fg-muted",
        render: (s) => s.process || "—",
      },
    ],
    [],
  );
  return (
    <SshDataTable
      items={sockets}
      columns={columns}
      getRowKey={(s) => `${s.protocol}-${s.localAddress}-${s.process}`}
      loading={loading}
      onRefresh={onRefresh}
      toolbarLeft={toolbarLeft}
      searchable
      searchPlaceholder="搜索地址 / 进程"
      filterFn={(s, q) =>
        s.localAddress.toLowerCase().includes(q) ||
        s.process.toLowerCase().includes(q) ||
        s.protocol.toLowerCase().includes(q)
      }
      emptyText="无监听端口"
    />
  );
}

function ConnectionView({
  connections,
  loading,
  onRefresh,
  toolbarLeft,
}: SubViewProps & { connections: SshConnectionEntry[] }) {
  const columns = useMemo<SshColumn<SshConnectionEntry>[]>(
    () => [
      {
        key: "protocol",
        header: "协议",
        width: "80px",
        sortable: true,
        compare: (a, b) => a.protocol.localeCompare(b.protocol),
        render: (c) => <ProtocolBadge protocol={c.protocol} />,
      },
      {
        key: "local",
        header: "本地地址",
        width: "minmax(160px,1fr)",
        sortable: true,
        compare: (a, b) => a.localAddress.localeCompare(b.localAddress),
        cellClassName: "px-2 truncate font-mono",
        render: (c) => c.localAddress,
      },
      {
        key: "peer",
        header: "远程地址",
        width: "minmax(160px,1fr)",
        sortable: true,
        compare: (a, b) => a.peerAddress.localeCompare(b.peerAddress),
        cellClassName: "px-2 truncate font-mono",
        render: (c) => c.peerAddress,
      },
      {
        key: "state",
        header: "状态",
        width: "100px",
        sortable: true,
        compare: (a, b) => a.state.localeCompare(b.state),
        render: (c) => <StateBadge state={c.state} />,
      },
      {
        key: "process",
        header: "进程",
        width: "minmax(140px,1fr)",
        sortable: true,
        compare: (a, b) => a.process.localeCompare(b.process),
        cellClassName: "px-2 truncate text-fg-muted",
        render: (c) => c.process || "—",
      },
    ],
    [],
  );
  return (
    <SshDataTable
      items={connections}
      columns={columns}
      getRowKey={(c) =>
        `${c.protocol}-${c.localAddress}-${c.peerAddress}-${c.process}`
      }
      loading={loading}
      onRefresh={onRefresh}
      toolbarLeft={toolbarLeft}
      searchable
      searchPlaceholder="搜索地址 / 状态 / 进程"
      filterFn={(c, q) =>
        c.localAddress.toLowerCase().includes(q) ||
        c.peerAddress.toLowerCase().includes(q) ||
        c.state.toLowerCase().includes(q) ||
        c.process.toLowerCase().includes(q)
      }
      emptyText="无活跃连接"
    />
  );
}

function RouteView({
  routes,
  loading,
  onRefresh,
  toolbarLeft,
}: SubViewProps & { routes: SshRouteEntry[] }) {
  const columns = useMemo<SshColumn<SshRouteEntry>[]>(
    () => [
      {
        key: "destination",
        header: "目标",
        width: "minmax(160px,1.2fr)",
        sortable: true,
        compare: (a, b) => a.destination.localeCompare(b.destination),
        render: (r) => (
          <span
            className={`font-mono truncate ${
              r.destination === "default"
                ? "text-emerald-400"
                : "text-fg-secondary"
            }`}
          >
            {r.destination}
          </span>
        ),
      },
      {
        key: "gateway",
        header: "网关",
        width: "minmax(140px,1fr)",
        sortable: true,
        compare: (a, b) => a.gateway.localeCompare(b.gateway),
        cellClassName: "px-2 truncate font-mono",
        render: (r) => r.gateway || "—",
      },
      {
        key: "iface",
        header: "接口",
        width: "110px",
        sortable: true,
        compare: (a, b) => a.iface.localeCompare(b.iface),
        cellClassName: "px-2 truncate font-mono text-fg-muted",
        render: (r) => r.iface || "—",
      },
      {
        key: "protocol",
        header: "协议",
        width: "90px",
        cellClassName: "px-2 truncate text-fg-muted",
        render: (r) => r.protocol || "—",
      },
      {
        key: "scope",
        header: "范围",
        width: "90px",
        cellClassName: "px-2 truncate text-fg-muted",
        render: (r) => r.scope || "—",
      },
      {
        key: "metric",
        header: "Metric",
        width: "80px",
        align: "right",
        sortable: true,
        compare: (a, b) => (Number(a.metric) || 0) - (Number(b.metric) || 0),
        render: (r) => r.metric || "—",
      },
    ],
    [],
  );
  return (
    <SshDataTable
      items={routes}
      columns={columns}
      getRowKey={(r) => `${r.destination}-${r.iface}-${r.gateway}`}
      loading={loading}
      onRefresh={onRefresh}
      toolbarLeft={toolbarLeft}
      emptyText="无路由信息"
    />
  );
}

function ProtocolBadge({ protocol }: { protocol: string }) {
  const isTcp = protocol.toLowerCase().startsWith("tcp");
  return (
    <span
      className={`text-[10px] font-mono px-1 py-0.5 rounded ${
        isTcp
          ? "bg-blue-500/15 text-blue-400"
          : "bg-amber-500/15 text-amber-400"
      }`}
    >
      {protocol.toUpperCase()}
    </span>
  );
}

function StateBadge({ state }: { state: string }) {
  const color =
    state === "ESTAB"
      ? "text-emerald-400"
      : state === "TIME-WAIT"
        ? "text-amber-400"
        : state === "CLOSE-WAIT"
          ? "text-red-400"
          : "text-fg-muted";

  return <span className={`font-mono ${color}`}>{state}</span>;
}
