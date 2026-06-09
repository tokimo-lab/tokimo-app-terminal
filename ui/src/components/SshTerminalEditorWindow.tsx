/**
 * SSH terminal editor modal window — create / edit / duplicate a connection.
 *
 * Mounted in the HOST React tree, so it reads its `AppRuntimeCtx` and result
 * callback from the module-level `modal-bridge` registry (keyed by the
 * `bridgeId` forwarded via window metadata), then re-establishes the app
 * provider tree.
 */

import { RuntimeProvider, type ShellWindowHandle } from "@tokimo/sdk";
import { ConfigProvider, enUS, ToastProvider, zhCN } from "@tokimo/ui";
import { useEffect, useState } from "react";
import { AppCtxProvider } from "../AppContext";
import { terminalApi } from "../api/client";
import type {
  CreateSshTerminalInput,
  SshTerminalOutput,
  UpdateSshTerminalInput,
} from "../api/types";
import { getBridge, type TerminalEditorBridge } from "../modal-bridge";
import SshTerminalForm from "./SshTerminalForm";

function EditorContent({
  win,
  bridge,
}: {
  win: ShellWindowHandle;
  bridge: TerminalEditorBridge;
}) {
  const { terminalId, duplicateId, onSaved } = bridge;
  const sourceId = terminalId ?? duplicateId;
  const [source, setSource] = useState<SshTerminalOutput | null>(null);
  const [loading, setLoading] = useState(!!sourceId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    setLoading(true);
    terminalApi
      .get(sourceId)
      .then((t) => {
        if (!cancelled) setSource(t);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  const handleSubmit = async (
    data: CreateSshTerminalInput | UpdateSshTerminalInput,
  ) => {
    setSaving(true);
    try {
      if (terminalId) {
        const { id: _omit, ...rest } = data as UpdateSshTerminalInput;
        const updated = await terminalApi.update(terminalId, rest);
        onSaved?.(updated.id, true);
      } else {
        const created = await terminalApi.create(data as CreateSshTerminalInput);
        onSaved?.(created.id, false);
      }
      win.close();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-fg-muted">
        加载中...
      </div>
    );
  }

  // Edit mode passes the loaded terminal; duplicate mode prefills via
  // defaultValues with a "副本" suffix and creates a fresh connection.
  const isEdit = !!terminalId;
  const defaultValues =
    !isEdit && source
      ? {
          name: `${source.name} 副本`,
          host: source.host,
          port: source.port,
          username: source.username,
          authMethod: source.authMethod,
          startupCommand: source.startupCommand ?? undefined,
          notes: source.notes ?? undefined,
        }
      : undefined;

  return (
    <div className="h-full overflow-y-auto p-4">
      <SshTerminalForm
        terminal={isEdit ? source : null}
        defaultValues={defaultValues}
        onSubmit={handleSubmit}
        onCancel={() => win.close()}
        isLoading={saving}
      />
    </div>
  );
}

export default function SshTerminalEditorWindow({
  win,
}: {
  win: ShellWindowHandle;
}) {
  const bridgeId =
    typeof win.metadata?.bridgeId === "string"
      ? win.metadata.bridgeId
      : undefined;
  const [bridge] = useState(() => (bridgeId ? getBridge(bridgeId) : undefined));

  if (!bridge) return null;

  const locale = bridge.ctx.locale.startsWith("zh") ? zhCN : enUS;

  return (
    <RuntimeProvider value={bridge.ctx}>
      <AppCtxProvider value={bridge.ctx}>
        <ConfigProvider locale={locale}>
          <ToastProvider>
            <EditorContent win={win} bridge={bridge} />
          </ToastProvider>
        </ConfigProvider>
      </AppCtxProvider>
    </RuntimeProvider>
  );
}
