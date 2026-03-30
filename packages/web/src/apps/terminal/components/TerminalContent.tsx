/**
 * TerminalContent — Window content adapter for SSH terminals.
 */

import { Spin } from "@tokiomo/components";
import { lazy, Suspense } from "react";
import type { WindowState } from "@/system";

const SshTerminalWindow = lazy(
  () => import("@/apps/terminal/components/SshTerminalWindow"),
);

export default function TerminalContent({ win }: { win: WindowState }) {
  if (!win.metadata.sshTerminalId) return null;

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spin />
        </div>
      }
    >
      <SshTerminalWindow
        terminalId={win.metadata.sshTerminalId}
        windowId={win.id}
      />
    </Suspense>
  );
}
