/**
 * Bottom panel component for SSH terminal.
 * Renders tabbed panel with file browser, processes, storage, network, docker tabs.
 * Preserves all TabButton usages, className strings, Chinese labels, biome-ignore comments.
 */

import {
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
import { TabButton } from "./SshTerminalPanelBits";

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
          {/* Tab bar — click blank area to collapse/expand */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: drag/click area */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: collapse toggle, keyboard not needed */}
          <div
            className="flex items-center shrink-0 border-b border-black/[0.06] dark:border-zinc-800/40 cursor-pointer select-none"
            onClick={onToggleCollapse}
          >
            <TabButton
              active={bottomTab === "files"}
              collapsed={panelCollapsed}
              onClick={(e) => {
                e.stopPropagation();
                onTabButtonClick("files");
              }}
              icon={<FolderTree className="h-3 w-3" />}
              label="文件"
              badge={activeUploadCount > 0 ? activeUploadCount : undefined}
            />
            <TabButton
              active={bottomTab === "processes"}
              collapsed={panelCollapsed}
              onClick={(e) => {
                e.stopPropagation();
                onTabButtonClick("processes");
              }}
              icon={<ListTree className="h-3 w-3" />}
              label="进程"
            />
            <TabButton
              active={bottomTab === "storage"}
              collapsed={panelCollapsed}
              onClick={(e) => {
                e.stopPropagation();
                onTabButtonClick("storage");
              }}
              icon={<HardDrive className="h-3 w-3" />}
              label="存储"
            />
            <TabButton
              active={bottomTab === "network"}
              collapsed={panelCollapsed}
              onClick={(e) => {
                e.stopPropagation();
                onTabButtonClick("network");
              }}
              icon={<Network className="h-3 w-3" />}
              label="网络"
            />
            <TabButton
              active={bottomTab === "docker"}
              collapsed={panelCollapsed}
              onClick={(e) => {
                e.stopPropagation();
                onTabButtonClick("docker");
              }}
              icon={<Container className="h-3 w-3" />}
              label="Docker"
            />
            {/* flex-1 spacer makes the rest of the bar clickable */}
            <div className="flex-1" />
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
