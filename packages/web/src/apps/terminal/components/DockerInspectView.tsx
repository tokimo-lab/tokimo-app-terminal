/**
 * Docker container detail / inspect view for SSH Docker panel.
 * Shows container config, mounts, env, networks, etc.
 */
import { LoadingOutlined } from "@tokiomo/components";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/generated/rust-api";
import type { DockerContainerInspect } from "@/generated/rust-types/DockerContainerInspect";

interface DockerInspectViewProps {
  terminalId: string;
  containerId: string;
  onBack: () => void;
}

export default function DockerInspectView({
  terminalId,
  containerId,
  onBack,
}: DockerInspectViewProps) {
  const [data, setData] = useState<DockerContainerInspect | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchInspect = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await api.sshTerminal.dockerInspect.fetch({
        id: terminalId,
        containerId,
      });
      setData(resp.container);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [terminalId, containerId]);

  useEffect(() => {
    fetchInspect();
  }, [fetchInspect]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-zinc-800/60 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="p-0.5 text-fg-muted hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
        </button>
        <span className="text-xs text-fg-secondary font-medium truncate">
          {containerId}
        </span>
        <button
          type="button"
          onClick={fetchInspect}
          className="p-0.5 text-fg-muted hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors ml-auto"
        >
          {loading ? (
            <LoadingOutlined className="h-3 w-3" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 text-xs">
        {loading && !data ? (
          <div className="text-fg-muted">加载中...</div>
        ) : !data ? (
          <div className="text-fg-muted">无法获取容器信息</div>
        ) : (
          <>
            {/* Basic info */}
            <Section title="基本信息">
              <Row label="名称" value={data.name} />
              <Row label="镜像" value={data.image} mono />
              <Row label="状态" value={data.state} />
              <Row label="PID" value={String(data.pid)} />
              <Row label="启动时间" value={formatTime(data.startedAt)} />
              {data.finishedAt && !data.finishedAt.startsWith("0001") && (
                <Row label="停止时间" value={formatTime(data.finishedAt)} />
              )}
              <Row label="重启次数" value={String(data.restartCount)} />
              {data.platform && <Row label="平台" value={data.platform} />}
              <Row label="主机名" value={data.hostname} />
              <Row label="工作目录" value={data.workingDir || "-"} mono />
            </Section>

            {/* Command */}
            <Section title="命令">
              {data.entrypoint && (
                <Row label="Entrypoint" value={data.entrypoint} mono />
              )}
              {data.cmd && <Row label="Cmd" value={data.cmd} mono />}
            </Section>

            {/* Networks */}
            <Section title="网络">
              <Row label="模式" value={data.networkMode} />
              {data.networks.length > 0 && (
                <table className="w-full border-collapse mt-1">
                  <thead>
                    <tr className="text-fg-muted">
                      <th className="text-left font-normal pr-2">网络</th>
                      <th className="text-left font-normal pr-2">IP</th>
                      <th className="text-left font-normal pr-2">网关</th>
                      <th className="text-left font-normal">MAC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.networks.map((n) => (
                      <tr key={n.name} className="text-fg-muted">
                        <td className="pr-2 py-0.5">{n.name}</td>
                        <td className="pr-2 py-0.5 font-mono">
                          {n.ipAddress || "-"}
                        </td>
                        <td className="pr-2 py-0.5 font-mono">
                          {n.gateway || "-"}
                        </td>
                        <td className="py-0.5 font-mono text-fg-muted">
                          {n.macAddress || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            {/* Port bindings */}
            {data.portBindings && data.portBindings !== "{}" && (
              <Section title="端口映射">
                <pre className="text-[10px] text-fg-muted font-mono whitespace-pre-wrap break-all">
                  {formatPortBindings(data.portBindings)}
                </pre>
              </Section>
            )}

            {/* Mounts */}
            {data.mounts.length > 0 && (
              <Section title="挂载">
                <table className="w-full border-collapse mt-1">
                  <thead>
                    <tr className="text-fg-muted">
                      <th className="text-left font-normal pr-2">源</th>
                      <th className="text-left font-normal pr-2">目标</th>
                      <th className="text-left font-normal pr-2">模式</th>
                      <th className="text-left font-normal">读写</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.mounts.map((m) => (
                      <tr
                        key={`${m.source}-${m.destination}`}
                        className="text-fg-muted"
                      >
                        <td className="pr-2 py-0.5 font-mono truncate max-w-40">
                          {m.source}
                        </td>
                        <td className="pr-2 py-0.5 font-mono truncate max-w-40">
                          {m.destination}
                        </td>
                        <td className="pr-2 py-0.5">{m.mode || "-"}</td>
                        <td className="py-0.5">{m.rw ? "RW" : "RO"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
            )}

            {/* Environment */}
            {data.env.length > 0 && (
              <Section title={`环境变量 (${data.env.length})`}>
                <div className="max-h-40 overflow-y-auto font-mono text-[10px] space-y-px">
                  {data.env.map((e) => {
                    const eqIdx = e.indexOf("=");
                    const key = eqIdx > 0 ? e.slice(0, eqIdx) : e;
                    const val = eqIdx > 0 ? e.slice(eqIdx + 1) : "";
                    return (
                      <div key={e} className="flex gap-1">
                        <span className="text-fg-muted shrink-0">{key}=</span>
                        <span className="text-fg-muted break-all">{val}</span>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
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
      <div className="text-[10px] text-fg-muted uppercase tracking-wider mb-1">
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
      <span className="text-fg-muted w-20 shrink-0">{label}</span>
      <span className={`text-fg-muted break-all ${mono ? "font-mono" : ""}`}>
        {value || "-"}
      </span>
    </div>
  );
}

function formatTime(iso: string): string {
  if (!iso || iso.startsWith("0001")) return "-";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatPortBindings(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<
      string,
      Array<{ HostIp: string; HostPort: string }> | null
    >;
    return Object.entries(parsed)
      .map(([containerPort, bindings]) => {
        if (!bindings || bindings.length === 0)
          return `${containerPort} → (none)`;
        return bindings
          .map(
            (b) => `${b.HostIp || "0.0.0.0"}:${b.HostPort} → ${containerPort}`,
          )
          .join("\n");
      })
      .join("\n");
  } catch {
    return raw;
  }
}
