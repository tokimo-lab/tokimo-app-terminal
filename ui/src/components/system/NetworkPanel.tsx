import { Empty, Spin, Table, type TableColumn } from "@tokimo/ui";
import { useCallback, useState } from "react";
import { terminalApi } from "../../api/client";
import type {
  SshConnectionEntry,
  SshListeningSocketEntry,
  SshNetworkInterfaceEntry,
  SshNetworkResponse,
  SshRouteEntry,
} from "../../api/types";
import { useAsync } from "../../hooks/useAsync";
import { formatBytes } from "../../lib/format";

interface NetworkPanelProps {
  terminalId: string;
  refreshToken: number;
}

type SubTab = "interfaces" | "listening" | "connections" | "routes";

function ProtocolBadge({ protocol }: { protocol: string }) {
  const isTcp = protocol.toLowerCase().startsWith("tcp");
  return (
    <span
      className={`rounded px-1 py-0.5 font-mono text-[10px] ${
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
          : "text-zinc-400";
  return <span className={`font-mono ${color}`}>{state}</span>;
}

const interfaceColumns: TableColumn<SshNetworkInterfaceEntry>[] = [
  {
    title: "Interface",
    key: "name",
    width: 140,
    render: (_value: unknown, i: SshNetworkInterfaceEntry) => (
      <span className="font-mono text-zinc-200">{i.name}</span>
    ),
  },
  {
    title: "State",
    key: "state",
    width: 90,
    render: (_value: unknown, i: SshNetworkInterfaceEntry) => (
      <span
        className={`inline-flex items-center gap-1 ${i.isUp ? "text-emerald-400" : "text-zinc-500"}`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${i.isUp ? "bg-emerald-400" : "bg-zinc-600"}`}
        />
        {i.isUp ? "UP" : "DOWN"}
      </span>
    ),
  },
  {
    title: "IP Addresses",
    key: "ip",
    render: (_value: unknown, i: SshNetworkInterfaceEntry) => (
      <span className="font-mono text-zinc-300">
        {i.ipAddresses.length > 0 ? i.ipAddresses.join(", ") : "—"}
      </span>
    ),
  },
  {
    title: "MAC",
    key: "mac",
    width: 150,
    render: (_value: unknown, i: SshNetworkInterfaceEntry) => (
      <span className="font-mono text-zinc-400">{i.macAddress || "—"}</span>
    ),
  },
  {
    title: "MTU",
    key: "mtu",
    width: 80,
    align: "right",
    render: (_value: unknown, i: SshNetworkInterfaceEntry) => i.mtu ?? "—",
  },
  {
    title: "RX",
    key: "rx",
    width: 90,
    align: "right",
    sorter: (a, b) => a.rxBytes - b.rxBytes,
    render: (_value: unknown, i: SshNetworkInterfaceEntry) =>
      formatBytes(i.rxBytes),
  },
  {
    title: "TX",
    key: "tx",
    width: 90,
    align: "right",
    sorter: (a, b) => a.txBytes - b.txBytes,
    render: (_value: unknown, i: SshNetworkInterfaceEntry) =>
      formatBytes(i.txBytes),
  },
];

const socketColumns: TableColumn<SshListeningSocketEntry>[] = [
  {
    title: "Proto",
    key: "protocol",
    width: 80,
    render: (_value: unknown, s: SshListeningSocketEntry) => (
      <ProtocolBadge protocol={s.protocol} />
    ),
  },
  {
    title: "Local Address",
    key: "local",
    render: (_value: unknown, s: SshListeningSocketEntry) => (
      <span className="font-mono text-zinc-200">{s.localAddress}</span>
    ),
  },
  {
    title: "Process",
    key: "process",
    render: (_value: unknown, s: SshListeningSocketEntry) => (
      <span className="font-mono text-zinc-400">{s.process || "—"}</span>
    ),
  },
];

const connectionColumns: TableColumn<SshConnectionEntry>[] = [
  {
    title: "Proto",
    key: "protocol",
    width: 80,
    render: (_value: unknown, c: SshConnectionEntry) => (
      <ProtocolBadge protocol={c.protocol} />
    ),
  },
  {
    title: "Local Address",
    key: "local",
    render: (_value: unknown, c: SshConnectionEntry) => (
      <span className="font-mono text-zinc-200">{c.localAddress}</span>
    ),
  },
  {
    title: "Peer Address",
    key: "peer",
    render: (_value: unknown, c: SshConnectionEntry) => (
      <span className="font-mono text-zinc-200">{c.peerAddress}</span>
    ),
  },
  {
    title: "State",
    key: "state",
    width: 110,
    render: (_value: unknown, c: SshConnectionEntry) => (
      <StateBadge state={c.state} />
    ),
  },
  {
    title: "Process",
    key: "process",
    render: (_value: unknown, c: SshConnectionEntry) => (
      <span className="font-mono text-zinc-400">{c.process || "—"}</span>
    ),
  },
];

const routeColumns: TableColumn<SshRouteEntry>[] = [
  {
    title: "Destination",
    key: "destination",
    render: (_value: unknown, r: SshRouteEntry) => (
      <span
        className={`font-mono ${r.destination === "default" ? "text-emerald-400" : "text-zinc-300"}`}
      >
        {r.destination}
      </span>
    ),
  },
  {
    title: "Gateway",
    key: "gateway",
    render: (_value: unknown, r: SshRouteEntry) => (
      <span className="font-mono text-zinc-300">{r.gateway || "—"}</span>
    ),
  },
  {
    title: "Iface",
    key: "iface",
    width: 110,
    render: (_value: unknown, r: SshRouteEntry) => (
      <span className="font-mono text-zinc-400">{r.iface || "—"}</span>
    ),
  },
  {
    title: "Proto",
    key: "protocol",
    width: 100,
    render: (_value: unknown, r: SshRouteEntry) => (
      <span className="text-zinc-400">{r.protocol || "—"}</span>
    ),
  },
  {
    title: "Scope",
    key: "scope",
    width: 100,
    render: (_value: unknown, r: SshRouteEntry) => (
      <span className="text-zinc-400">{r.scope || "—"}</span>
    ),
  },
  {
    title: "Metric",
    key: "metric",
    width: 90,
    align: "right",
    render: (_value: unknown, r: SshRouteEntry) => r.metric || "—",
  },
];

function SubTabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded px-2 py-1 text-xs transition-colors ${
        active
          ? "bg-white/10 text-zinc-100"
          : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {label} ({count})
    </button>
  );
}

function SectionTable<T extends object>({
  columns,
  data,
  rowKey,
  emptyText,
  loading,
}: {
  columns: TableColumn<T>[];
  data: T[];
  rowKey: (r: T) => string;
  emptyText: string;
  loading: boolean;
}) {
  if (data.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty description={emptyText} />
      </div>
    );
  }
  return (
    <Table<T>
      columns={columns}
      dataSource={data}
      rowKey={rowKey}
      size="small"
      pagination={false}
      loading={loading}
    />
  );
}

export function NetworkPanel({ terminalId, refreshToken }: NetworkPanelProps) {
  const [subTab, setSubTab] = useState<SubTab>("interfaces");
  const loader = useCallback(() => terminalApi.net(terminalId), [terminalId]);
  const { data, loading, error } = useAsync<SshNetworkResponse>(loader, [
    loader,
    refreshToken,
  ]);

  if (error) {
    return (
      <div className="m-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
        {error}
      </div>
    );
  }
  if (loading && !data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Spin />
      </div>
    );
  }

  const interfaces = data?.interfaces ?? [];
  const listening = data?.listening ?? [];
  const connections = data?.connections ?? [];
  const routes = data?.routes ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1.5">
        <SubTabButton
          active={subTab === "interfaces"}
          label="Interfaces"
          count={interfaces.length}
          onClick={() => setSubTab("interfaces")}
        />
        <SubTabButton
          active={subTab === "listening"}
          label="Listening"
          count={listening.length}
          onClick={() => setSubTab("listening")}
        />
        <SubTabButton
          active={subTab === "connections"}
          label="Connections"
          count={connections.length}
          onClick={() => setSubTab("connections")}
        />
        <SubTabButton
          active={subTab === "routes"}
          label="Routes"
          count={routes.length}
          onClick={() => setSubTab("routes")}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {subTab === "interfaces" && (
          <SectionTable
            columns={interfaceColumns}
            data={interfaces}
            rowKey={(i) => i.name}
            emptyText="No interfaces"
            loading={loading}
          />
        )}
        {subTab === "listening" && (
          <SectionTable
            columns={socketColumns}
            data={listening}
            rowKey={(s) => `${s.protocol}-${s.localAddress}-${s.process}`}
            emptyText="No listening sockets"
            loading={loading}
          />
        )}
        {subTab === "connections" && (
          <SectionTable
            columns={connectionColumns}
            data={connections}
            rowKey={(c) =>
              `${c.protocol}-${c.localAddress}-${c.peerAddress}-${c.process}`
            }
            emptyText="No active connections"
            loading={loading}
          />
        )}
        {subTab === "routes" && (
          <SectionTable
            columns={routeColumns}
            data={routes}
            rowKey={(r) => `${r.destination}-${r.iface}-${r.gateway}`}
            emptyText="No routes"
            loading={loading}
          />
        )}
      </div>
    </div>
  );
}
