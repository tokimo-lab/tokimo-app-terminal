/**
 * Bottom panel component for SSH terminal.
 * Renders tabbed panel with file browser, processes, storage, network, docker tabs.
 */

import { Tabs, Tooltip } from "@tokimo/ui";
import {
  ChevronsDown,
  ChevronsUp,
  Container,
  FolderTree,
  HardDrive,
  ListTree,
  Network,
} from "lucide-react";
import type React from "react";
import type { UploadQueue } from "./SshUploadQueue";
import SshDockerPanel from "./SshDockerPanel";
import SshFileTree from "./SshFileTree";
import SshNetworkPanel from "./SshNetworkPanel";
import SshProcessList from "./SshProcessList";
import SshStoragePanel from "./SshStoragePanel";

type BottomTab = "files" | "processes" | "storage" | "network" | "docker";

interface SshTerminalBottomPanelProps {
  terminalId: string;
  connected: boolean;
  panelCollapsed: boolean;
  panelHeight: number;
  bottomTab: BottomTab;
  uploadQueue: UploadQueue;
  activeUploadCount: number;
  connectionLabel?: string;
  onToggleCollapse: () => void;
  onTabButtonClick: (tab: BottomTab) => void;
  onUploadFiles: (targetDir: string, files: File[]) => void;
  onFileBrowserPathChange: (path: string) => void;
  onDragStart: (e: React.MouseEvent) => void;
}

export default function SshTerminalBottomPanel({
  terminalId,
  connected,
  panelCollapsed,
  panelHeight,
  bottomTab,
  uploadQueue,
  activeUploadCount,
  connectionLabel,
  onToggleCollapse,
  onTabButtonClick,
  onUploadFiles,
  onFileBrowserPathChange,
  onDragStart,
}: SshTerminalBottomPanelProps) {
  return (
    <>
      {/* ── Drag handle ── */}
      {connected && !panelCollapsed && (
        // biome-ignore lint/a11y/noStaticElementInteractions: drag resize handle
        <div
          className="shrink-0 h-1 cursor-row-resize bg-black/[0.06] dark:bg-zinc-800/60 hover:bg-black/[0.10] dark:hover:bg-zinc-600/60 active:bg-emerald-600/80 transition-colors"
          onMouseDown={onDragStart}
        />
      )}

      {/* ── Bottom: tabbed panel (hidden until connected) ── */}
      {connected && (
        <div
          className="shrink-0 bg-black/[0.04] dark:bg-zinc-900/40 flex flex-col overflow-hidden"
          style={panelCollapsed ? undefined : { height: panelHeight }}
        >
          {/* Tab bar — click blank area to expand when collapsed */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: click to expand */}
          <div
            className="shrink-0"
            onClick={panelCollapsed ? onToggleCollapse : undefined}
          >
            <Tabs
              type="line"
              size="small"
              activeKey={bottomTab}
              onChange={(key) => onTabButtonClick(key as BottomTab)}
              sticky={false}
              items={[
                {
                  key: "files",
                  label: "文件",
                  icon: <FolderTree className="h-3 w-3" />,
                  badge: activeUploadCount > 0 ? activeUploadCount : undefined,
                },
                {
                  key: "processes",
                  label: "进程",
                  icon: <ListTree className="h-3 w-3" />,
                },
                {
                  key: "storage",
                  label: "存储",
                  icon: <HardDrive className="h-3 w-3" />,
                },
                {
                  key: "network",
                  label: "网络",
                  icon: <Network className="h-3 w-3" />,
                },
                {
                  key: "docker",
                  label: "Docker",
                  icon: <Container className="h-3 w-3" />,
                },
              ]}
              tabBarExtraContent={
                !panelCollapsed ? (
                  <Tooltip title="收起面板">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleCollapse();
                      }}
                      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-fg-muted transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                    >
                      <ChevronsDown size={14} />
                    </button>
                  </Tooltip>
                ) : (
                  <Tooltip title="展开面板">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleCollapse();
                      }}
                      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-fg-muted transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                    >
                      <ChevronsUp size={14} />
                    </button>
                  </Tooltip>
                )
              }
            />
          </div>

          {/* Tab content - hidden when collapsed */}
          {!panelCollapsed && (
            <div className="flex-1 overflow-hidden">
              {bottomTab === "files" ? (
                <SshFileTree
                  terminalId={terminalId}
                  connected={connected}
                  uploadQueue={uploadQueue}
                  onUploadFiles={onUploadFiles}
                  connectionLabel={connectionLabel}
                  onPathChange={onFileBrowserPathChange}
                />
              ) : bottomTab === "processes" ? (
                <SshProcessList terminalId={terminalId} connected={connected} />
              ) : bottomTab === "docker" ? (
                <SshDockerPanel terminalId={terminalId} connected={connected} />
              ) : bottomTab === "network" ? (
                <SshNetworkPanel
                  terminalId={terminalId}
                  connected={connected}
                />
              ) : (
                <SshStoragePanel
                  terminalId={terminalId}
                  connected={connected}
                />
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
