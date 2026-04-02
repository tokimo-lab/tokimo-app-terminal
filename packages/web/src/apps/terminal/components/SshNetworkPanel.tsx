/**
 * Remote network visualization panel for SSH terminal.
 * Fetches network info via /api/apps/terminal/connections/{id}/net endpoint.
 * Displays interfaces, listening sockets, and active connections.
 */
import { LoadingOutlined } from "@tokiomo/components";
import { Network, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/generated/rust-api";
import type { SshConnectionEntry } from "@/generated/rust-types/SshConnectionEntry";
import type { SshListeningSocketEntry } from "@/generated/rust-types/SshListeningSocketEntry";
import type { SshNetworkInterfaceEntry } from "@/generated/rust-types/SshNetworkInterfaceEntry";
import type { SshRouteEntry } from "@/generated/rust-types/SshRouteEntry";
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
      const resp = await api.sshTerminal.net.fetch({ id: terminalId });
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-black/[0.08] dark:border-zinc-800/60 shrink-0">
        <div className="flex items-center gap-2">
          {/* Sub-tabs */}
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
        <button
          type="button"
          onClick={fetchNetwork}
          className="p-0.5 text-fg-muted hover:text-zinc-800 dark:hover:text-zinc-300 transition-colors"
          title="刷新网络信息"
        >
          {loading ? (
            <LoadingOutlined className="h-3 w-3" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && interfaces.length === 0 ? (
          <div className="text-fg-muted text-xs px-3 py-2">加载中...</div>
        ) : subTab === "interfaces" ? (
          <InterfaceTable interfaces={interfaces} />
        ) : subTab === "listening" ? (
          <ListeningTable sockets={listening} />
        ) : subTab === "connections" ? (
          <ConnectionTable connections={connections} />
        ) : (
          <RouteTable routes={routes} />
        )}
      </div>
    </div>
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
      className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
        active
          ? "text-zinc-800 dark:text-zinc-200 bg-black/[0.08] dark:bg-zinc-700/60"
          : "text-fg-muted hover:text-zinc-800 dark:hover:text-zinc-400"
      }`}
    >
      {label}
    </button>
  );
}

function InterfaceTable({
  interfaces,
}: {
  interfaces: SshNetworkInterfaceEntry[];
}) {
  if (interfaces.length === 0) {
    return <div className="text-fg-muted text-xs px-3 py-2">无网络接口</div>;
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-[10px] text-fg-muted border-b border-black/[0.08] dark:border-zinc-800/60">
          <th className="text-left font-normal px-3 py-1">接口</th>
          <th className="text-left font-normal px-2 py-1">状态</th>
          <th className="text-left font-normal px-2 py-1">IP 地址</th>
          <th className="text-left font-normal px-2 py-1">MAC</th>
          <th className="text-right font-normal px-2 py-1">MTU</th>
          <th className="text-right font-normal px-2 py-1">RX</th>
          <th className="text-right font-normal px-2 py-1">TX</th>
        </tr>
      </thead>
      <tbody>
        {interfaces.map((iface) => (
          <InterfaceRow key={iface.name} iface={iface} />
        ))}
      </tbody>
    </table>
  );
}

function InterfaceRow({ iface }: { iface: SshNetworkInterfaceEntry }) {
  return (
    <tr className="border-b border-black/[0.05] dark:border-zinc-800/30 hover:bg-black/[0.04] dark:hover:bg-zinc-800/30 transition-colors">
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <Network className="h-3 w-3 shrink-0 text-[var(--accent-text)]" />
          <span className="text-zinc-800 dark:text-zinc-200 font-mono">
            {iface.name}
          </span>
        </div>
      </td>
      <td className="px-2 py-1.5">
        <span
          className={`inline-flex items-center gap-1 text-[10px] ${
            iface.isUp ? "text-emerald-400" : "text-fg-muted"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              iface.isUp ? "bg-emerald-400" : "bg-zinc-400 dark:bg-zinc-600"
            }`}
          />
          {iface.isUp ? "UP" : "DOWN"}
        </span>
      </td>
      <td className="px-2 py-1.5">
        <div className="flex flex-col gap-0.5">
          {iface.ipAddresses.length > 0 ? (
            iface.ipAddresses.map((ip) => (
              <span
                key={ip}
                className="text-fg-secondary font-mono text-[10px]"
              >
                {ip}
              </span>
            ))
          ) : (
            <span className="text-fg-muted">—</span>
          )}
        </div>
      </td>
      <td className="px-2 py-1.5 text-fg-muted dark:text-zinc-300 font-mono text-[10px]">
        {iface.macAddress || "—"}
      </td>
      <td className="px-2 py-1.5 text-right text-fg-secondary tabular-nums">
        {iface.mtu ?? "—"}
      </td>
      <td className="px-2 py-1.5 text-right text-fg-secondary tabular-nums">
        {formatBytes(iface.rxBytes)}
      </td>
      <td className="px-2 py-1.5 text-right text-fg-secondary tabular-nums">
        {formatBytes(iface.txBytes)}
      </td>
    </tr>
  );
}

function ListeningTable({ sockets }: { sockets: SshListeningSocketEntry[] }) {
  if (sockets.length === 0) {
    return <div className="text-fg-muted text-xs px-3 py-2">无监听端口</div>;
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-[10px] text-fg-muted border-b border-black/[0.08] dark:border-zinc-800/60">
          <th className="text-left font-normal px-3 py-1">协议</th>
          <th className="text-left font-normal px-2 py-1">本地地址</th>
          <th className="text-left font-normal px-2 py-1">进程</th>
        </tr>
      </thead>
      <tbody>
        {sockets.map((s) => (
          <tr
            key={`${s.protocol}-${s.localAddress}-${s.process}`}
            className="border-b border-black/[0.05] dark:border-zinc-800/30 hover:bg-black/[0.04] dark:hover:bg-zinc-800/30 transition-colors"
          >
            <td className="px-3 py-1.5">
              <ProtocolBadge protocol={s.protocol} />
            </td>
            <td className="px-2 py-1.5 text-fg-secondary font-mono text-[10px]">
              {s.localAddress}
            </td>
            <td className="px-2 py-1.5 text-fg-muted">{s.process || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConnectionTable({
  connections,
}: {
  connections: SshConnectionEntry[];
}) {
  if (connections.length === 0) {
    return <div className="text-fg-muted text-xs px-3 py-2">无活跃连接</div>;
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-[10px] text-fg-muted border-b border-black/[0.08] dark:border-zinc-800/60">
          <th className="text-left font-normal px-3 py-1">协议</th>
          <th className="text-left font-normal px-2 py-1">本地地址</th>
          <th className="text-left font-normal px-2 py-1">远程地址</th>
          <th className="text-left font-normal px-2 py-1">状态</th>
          <th className="text-left font-normal px-2 py-1">进程</th>
        </tr>
      </thead>
      <tbody>
        {connections.map((c) => (
          <tr
            key={`${c.protocol}-${c.localAddress}-${c.peerAddress}-${c.process}`}
            className="border-b border-black/[0.05] dark:border-zinc-800/30 hover:bg-black/[0.04] dark:hover:bg-zinc-800/30 transition-colors"
          >
            <td className="px-3 py-1.5">
              <ProtocolBadge protocol={c.protocol} />
            </td>
            <td className="px-2 py-1.5 text-fg-secondary font-mono text-[10px]">
              {c.localAddress}
            </td>
            <td className="px-2 py-1.5 text-fg-secondary font-mono text-[10px]">
              {c.peerAddress}
            </td>
            <td className="px-2 py-1.5">
              <StateBadge state={c.state} />
            </td>
            <td className="px-2 py-1.5 text-fg-muted">{c.process || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RouteTable({ routes }: { routes: SshRouteEntry[] }) {
  if (routes.length === 0) {
    return <div className="text-fg-muted text-xs px-3 py-2">无路由信息</div>;
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-[10px] text-fg-muted border-b border-black/[0.08] dark:border-zinc-800/60">
          <th className="text-left font-normal px-3 py-1">目标</th>
          <th className="text-left font-normal px-2 py-1">网关</th>
          <th className="text-left font-normal px-2 py-1">接口</th>
          <th className="text-left font-normal px-2 py-1">协议</th>
          <th className="text-left font-normal px-2 py-1">范围</th>
          <th className="text-right font-normal px-2 py-1">Metric</th>
        </tr>
      </thead>
      <tbody>
        {routes.map((r) => (
          <tr
            key={`${r.destination}-${r.iface}-${r.gateway}`}
            className="border-b border-black/[0.05] dark:border-zinc-800/30 hover:bg-black/[0.04] dark:hover:bg-zinc-800/30 transition-colors"
          >
            <td className="px-3 py-1.5">
              <span
                className={`font-mono text-[10px] ${
                  r.destination === "default"
                    ? "text-emerald-400"
                    : "text-fg-secondary"
                }`}
              >
                {r.destination}
              </span>
            </td>
            <td className="px-2 py-1.5 text-fg-secondary font-mono text-[10px]">
              {r.gateway || "—"}
            </td>
            <td className="px-2 py-1.5 text-fg-muted dark:text-zinc-300 font-mono text-[10px]">
              {r.iface || "—"}
            </td>
            <td className="px-2 py-1.5 text-fg-muted text-[10px]">
              {r.protocol || "—"}
            </td>
            <td className="px-2 py-1.5 text-fg-muted text-[10px]">
              {r.scope || "—"}
            </td>
            <td className="px-2 py-1.5 text-right text-fg-secondary tabular-nums">
              {r.metric || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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

  return <span className={`text-[10px] font-mono ${color}`}>{state}</span>;
}
