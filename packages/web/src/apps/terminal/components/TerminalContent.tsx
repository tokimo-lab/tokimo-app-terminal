/**
 * TerminalContent — Window content adapter for SSH terminals.
 */

import { Spin } from "@tokimo/ui";
import { lazy, Suspense } from "react";
import type { WindowState } from "@/system";

const SshTerminalWindow = lazy(
  () => import("@/apps/terminal/components/SshTerminalWindow"),
);

export default function TerminalContent({ win }: { win: WindowState }) {
  const terminalId = win.route?.startsWith("/terminals/")
    ? win.route.slice("/terminals/".length)
    : win.metadata.sshTerminalId;
  if (!terminalId) return null;

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spin />
        </div>
      }
    >
      <SshTerminalWindow terminalId={terminalId} windowId={win.id} />
    </Suspense>
  );
}
