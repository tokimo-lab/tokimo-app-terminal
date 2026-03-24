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
  return (
    <div className="h-full">
      <WebTerminal wsUrl={getTerminalWsUrl()} borderless />
    </div>
  );
}
