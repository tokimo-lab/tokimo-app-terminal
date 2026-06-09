import { Modal, Spin } from "@tokimo/ui";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { terminalApi } from "../../api/client";

interface LogsViewProps {
  terminalId: string;
  containerId: string;
  name: string;
  onClose: () => void;
}

const TAIL_OPTIONS = [100, 200, 500] as const;

/** Modal log viewer for a single container with a tail selector and refresh. */
export function LogsView({
  terminalId,
  containerId,
  name,
  onClose,
}: LogsViewProps) {
  const [tail, setTail] = useState<number>(200);
  const [logs, setLogs] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await terminalApi.dockerLogs(terminalId, containerId, tail);
      setLogs(resp.logs);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setLogs("");
    } finally {
      setLoading(false);
    }
  }, [terminalId, containerId, tail]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  return (
    <Modal
      open
      onCancel={onClose}
      title={
        <div className="flex items-center gap-2">
          <span className="truncate text-zinc-200">{name} logs</span>
          <select
            value={tail}
            onChange={(e) => setTail(Number(e.target.value))}
            className="cursor-pointer rounded border border-white/10 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300"
          >
            {TAIL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                tail {opt}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void fetchLogs()}
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
      width={760}
    >
      <div className="h-[60vh] overflow-auto rounded border border-white/10 bg-zinc-950">
        {loading && !logs ? (
          <div className="flex h-full items-center justify-center">
            <Spin spinning />
          </div>
        ) : error ? (
          <div className="p-3 text-sm text-red-300">{error}</div>
        ) : (
          <pre className="whitespace-pre-wrap break-all p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
            {logs || "(empty)"}
          </pre>
        )}
      </div>
    </Modal>
  );
}
