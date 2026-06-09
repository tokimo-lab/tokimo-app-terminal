import { Empty, Modal, Spin } from "@tokimo/ui";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { terminalApi } from "../../api/client";
import type { DockerContainerInspect } from "../../api/types";

interface InspectViewProps {
  terminalId: string;
  containerId: string;
  onClose: () => void;
}

/** Modal rendering structured `docker inspect` output for a container. */
export function InspectView({
  terminalId,
  containerId,
  onClose,
}: InspectViewProps) {
  const [data, setData] = useState<DockerContainerInspect | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInspect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await terminalApi.dockerInspect(terminalId, containerId);
      setData(resp.container);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [terminalId, containerId]);

  useEffect(() => {
    void fetchInspect();
  }, [fetchInspect]);

  return (
    <Modal
      open
      onCancel={onClose}
      title={
        <div className="flex items-center gap-2">
          <span className="truncate text-zinc-200">{containerId}</span>
          <button
            type="button"
            onClick={() => void fetchInspect()}
            className="cursor-pointer rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
            title="Refresh"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      }
      footer={null}
      width={720}
    >
      <div className="max-h-[64vh] space-y-3 overflow-y-auto text-xs text-zinc-300">
        {loading && !data ? (
          <div className="flex justify-center py-8">
            <Spin spinning />
          </div>
        ) : error ? (
          <div className="text-sm text-red-300">{error}</div>
        ) : !data ? (
          <Empty description="No container information" />
        ) : (
          <InspectBody data={data} />
        )}
      </div>
    </Modal>
  );
}

function InspectBody({ data }: { data: DockerContainerInspect }) {
  return (
    <>
      <Section title="Basic">
        <Row label="Name" value={data.name} />
        <Row label="Image" value={data.image} mono />
        <Row label="State" value={data.state} />
        <Row label="PID" value={String(data.pid)} />
        <Row label="Started" value={data.startedAt} />
        {data.finishedAt && !data.finishedAt.startsWith("0001") ? (
          <Row label="Finished" value={data.finishedAt} />
        ) : null}
        <Row label="Restarts" value={String(data.restartCount)} />
        {data.platform ? <Row label="Platform" value={data.platform} /> : null}
        <Row label="Hostname" value={data.hostname} />
        <Row label="Workdir" value={data.workingDir || "-"} mono />
      </Section>

      {data.entrypoint || data.cmd ? (
        <Section title="Command">
          {data.entrypoint ? (
            <Row label="Entrypoint" value={data.entrypoint} mono />
          ) : null}
          {data.cmd ? <Row label="Cmd" value={data.cmd} mono /> : null}
        </Section>
      ) : null}

      <Section title="Networks">
        <Row label="Mode" value={data.networkMode} />
        {data.networks.length > 0 ? (
          <table className="mt-1 w-full border-collapse">
            <thead>
              <tr className="text-zinc-500">
                <th className="pr-2 text-left font-normal">Network</th>
                <th className="pr-2 text-left font-normal">IP</th>
                <th className="pr-2 text-left font-normal">Gateway</th>
                <th className="text-left font-normal">MAC</th>
              </tr>
            </thead>
            <tbody>
              {data.networks.map((n) => (
                <tr key={n.name} className="text-zinc-400">
                  <td className="py-0.5 pr-2">{n.name}</td>
                  <td className="py-0.5 pr-2 font-mono">
                    {n.ipAddress || "-"}
                  </td>
                  <td className="py-0.5 pr-2 font-mono">{n.gateway || "-"}</td>
                  <td className="py-0.5 font-mono">{n.macAddress || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>

      {data.portBindings && data.portBindings !== "{}" ? (
        <Section title="Port bindings">
          <pre className="whitespace-pre-wrap break-all font-mono text-[10px] text-zinc-400">
            {formatPortBindings(data.portBindings)}
          </pre>
        </Section>
      ) : null}

      {data.mounts.length > 0 ? (
        <Section title="Mounts">
          <table className="mt-1 w-full border-collapse">
            <thead>
              <tr className="text-zinc-500">
                <th className="pr-2 text-left font-normal">Source</th>
                <th className="pr-2 text-left font-normal">Destination</th>
                <th className="pr-2 text-left font-normal">Mode</th>
                <th className="text-left font-normal">RW</th>
              </tr>
            </thead>
            <tbody>
              {data.mounts.map((m) => (
                <tr
                  key={`${m.source}-${m.destination}`}
                  className="text-zinc-400"
                >
                  <td className="max-w-40 truncate py-0.5 pr-2 font-mono">
                    {m.source}
                  </td>
                  <td className="max-w-40 truncate py-0.5 pr-2 font-mono">
                    {m.destination}
                  </td>
                  <td className="py-0.5 pr-2">{m.mode || "-"}</td>
                  <td className="py-0.5">{m.rw ? "RW" : "RO"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {data.env.length > 0 ? (
        <Section title={`Environment (${data.env.length})`}>
          <div className="max-h-40 space-y-px overflow-y-auto font-mono text-[10px]">
            {data.env.map((e) => {
              const eqIdx = e.indexOf("=");
              const key = eqIdx > 0 ? e.slice(0, eqIdx) : e;
              const val = eqIdx > 0 ? e.slice(eqIdx + 1) : "";
              return (
                <div key={e} className="flex gap-1">
                  <span className="shrink-0 text-zinc-500">{key}=</span>
                  <span className="break-all text-zinc-400">{val}</span>
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="w-24 shrink-0 text-zinc-500">{label}</span>
      <span className={`break-all text-zinc-400 ${mono ? "font-mono" : ""}`}>
        {value || "-"}
      </span>
    </div>
  );
}

interface PortBinding {
  HostIp?: string;
  HostPort?: string;
}

function formatPortBindings(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, PortBinding[] | null>;
    return Object.entries(parsed)
      .map(([containerPort, bindings]) => {
        if (!bindings || bindings.length === 0)
          return `${containerPort} → (none)`;
        return bindings
          .map(
            (b) =>
              `${b.HostIp || "0.0.0.0"}:${b.HostPort ?? ""} → ${containerPort}`,
          )
          .join("\n");
      })
      .join("\n");
  } catch {
    return raw;
  }
}
