import { useTranslation } from "react-i18next";
import WebTerminal from "../../../components/dashboard/WebTerminal";

/** Build the WebSocket URL for the PTY endpoint on the Rust server. */
function getTerminalWsUrl(): string {
  const rustServer =
    (typeof window !== "undefined" &&
      (import.meta.env as Record<string, string>).RUST_SERVER) ||
    "";

  const base = rustServer
    ? rustServer.replace(/\/$/, "")
    : window.location.origin;

  const wsBase = base.replace(/^http:/, "ws:").replace(/^https:/, "wss:");

  return `${wsBase}/api/terminal/ws`;
}

export default function SystemTerminalPage() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-100">
          {t("dashboard.menu.systemSettingsGroup.terminal")}
        </h1>
      </div>
      <WebTerminal wsUrl={getTerminalWsUrl()} />
    </div>
  );
}
