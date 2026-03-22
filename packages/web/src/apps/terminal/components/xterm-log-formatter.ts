/**
 * ANSI log formatter for xterm.js
 * Converts structured JSONL log entries into ANSI-colored terminal text.
 */
import type { DownloadLogEntry, SubscriptionLogEntry } from "@/types";

// ─── ANSI escape helpers ───────────────────────────────

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;

const FG_RED = `${ESC}31m`;
const FG_GREEN = `${ESC}32m`;
const FG_YELLOW = `${ESC}33m`;
const FG_BLUE = `${ESC}34m`;
const FG_MAGENTA = `${ESC}35m`;
const FG_CYAN = `${ESC}36m`;
const FG_WHITE = `${ESC}37m`;
const FG_GRAY = `${ESC}90m`;

// ─── Phase → color mapping ─────────────────────────────

const subscriptionPhaseColors: Record<string, string> = {
  start: FG_BLUE,
  searching: FG_MAGENTA,
  filtering: FG_CYAN,
  matching: FG_YELLOW,
  downloading: FG_GREEN,
  completed: FG_GREEN,
  error: FG_RED,
};

const downloadPhaseColors: Record<string, string> = {
  submit: FG_BLUE,
  "torrent-info": FG_MAGENTA,
  "file-selection": FG_CYAN,
  "download-started": FG_BLUE,
  "download-complete": FG_GREEN,
  "organize-scan": FG_MAGENTA,
  "organize-identify": FG_YELLOW,
  "organize-execute": FG_CYAN,
  "organize-scrape": FG_MAGENTA,
  "organize-complete": FG_GREEN,
  completed: FG_GREEN,
  error: FG_RED,
};

const subscriptionPhaseLabels: Record<string, string> = {
  start: "START",
  searching: "SEARCH",
  filtering: "FILTER",
  matching: "MATCH",
  downloading: "DOWNLOAD",
  completed: "DONE",
  error: "ERROR",
};

const downloadPhaseLabels: Record<string, string> = {
  submit: "SUBMIT",
  "torrent-info": "TORRENT",
  "file-selection": "FILES",
  "download-started": "DL-START",
  "download-complete": "DL-DONE",
  "organize-scan": "ORG-SCAN",
  "organize-identify": "ORG-ID",
  "organize-execute": "ORG-EXEC",
  "organize-scrape": "ORG-SCRAPE",
  "organize-complete": "ORG-DONE",
  completed: "DONE",
  error: "ERROR",
};

// ─── Formatting helpers ────────────────────────────────

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  } catch {
    return iso;
  }
}

function formatPhaseTag(
  phase: string,
  colors: Record<string, string>,
  labels: Record<string, string>,
): string {
  const color = colors[phase] ?? FG_WHITE;
  const label = labels[phase] ?? phase.toUpperCase();
  return `${color}${BOLD}[${label}]${RESET}`;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
}

function formatDiscountFactor(factor: number | null | undefined): string {
  if (factor === 0) return `${FG_GREEN}FREE${RESET}`;
  if (factor === 0.5) return `${FG_BLUE}50%${RESET}`;
  if (factor != null && factor < 1)
    return `${FG_CYAN}${Math.round(factor * 100)}%${RESET}`;
  return "";
}

// ─── Torrent list formatting ───────────────────────────

interface TorrentDetail {
  title: string;
  size?: string;
  seeders?: number;
  leechers?: number;
  siteId?: string;
  siteName?: string;
  detailsUrl?: string | null;
  downloadVolumeFactor?: number | null;
}

function formatTorrentList(torrents: TorrentDetail[]): string {
  const lines: string[] = [];
  lines.push(`${DIM}  ┌─ ${FG_WHITE}${torrents.length} torrents found${RESET}`);
  for (const tor of torrents) {
    const size = tor.size ?? "-";
    const sl = `${tor.seeders ?? "-"}/${tor.leechers ?? "-"}`;
    const site = tor.siteName ?? tor.siteId ?? "";
    const discount = formatDiscountFactor(tor.downloadVolumeFactor);
    const discStr = discount ? ` ${discount}` : "";
    // If URL exists, xterm web-links addon will auto-detect it
    const urlSuffix = tor.detailsUrl ? `  ${DIM}${tor.detailsUrl}${RESET}` : "";
    lines.push(
      `${DIM}  │${RESET} ${FG_WHITE}${tor.title}${RESET}  ${FG_GRAY}${size}  S/L ${sl}  ${site}${discStr}${RESET}${urlSuffix}`,
    );
  }
  lines.push(`${DIM}  └──${RESET}`);
  return lines.join("\r\n");
}

// ─── File structure formatting ─────────────────────────

interface FileStructureItem {
  path: string;
  size: number;
  selected: boolean;
  fileType: string;
}

function formatFileStructure(
  files: FileStructureItem[],
  totalSize: number,
  selectedSize: number,
): string {
  const selectedCount = files.filter((f) => f.selected).length;
  const lines: string[] = [];
  lines.push(
    `${DIM}  ┌─ ${FG_WHITE}${selectedCount}/${files.length} files selected  ${formatSize(selectedSize)} / ${formatSize(totalSize)}${RESET}`,
  );
  for (const f of files) {
    const icon = f.selected ? `${FG_GREEN}✓${RESET}` : `${FG_GRAY}✗${RESET}`;
    const nameColor = f.selected ? FG_WHITE : FG_GRAY;
    lines.push(
      `${DIM}  │${RESET} ${icon} ${nameColor}${f.path}${RESET}  ${FG_GRAY}${formatSize(f.size)}${RESET}`,
    );
  }
  lines.push(`${DIM}  └──${RESET}`);
  return lines.join("\r\n");
}

// ─── Generic details formatting ────────────────────────

function formatDetails(
  details: Record<string, unknown>,
  skipKeys: string[] = [],
): string {
  const entries = Object.entries(details).filter(
    ([k, v]) => v != null && v !== "" && !skipKeys.includes(k),
  );
  if (entries.length === 0) return "";
  const lines: string[] = [];
  lines.push(`${DIM}  ┌─ details${RESET}`);
  for (const [key, value] of entries) {
    const val = formatDetailValue(value);
    lines.push(`${DIM}  │${RESET} ${FG_GRAY}${key}:${RESET} ${val}`);
  }
  lines.push(`${DIM}  └──${RESET}`);
  return lines.join("\r\n");
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "✓" : "✗";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((v) => typeof v === "number")) {
      const sorted = [...value].sort((a, b) => a - b);
      return sorted.map((e) => `E${String(e).padStart(2, "0")}`).join(", ");
    }
    return value.join(", ");
  }
  return JSON.stringify(value);
}

// ─── File list formatting (download organize-scan) ─────

function formatFilesList(files: Array<Record<string, unknown>>): string {
  const lines: string[] = [];
  lines.push(`${DIM}  ┌─ ${FG_WHITE}${files.length} files${RESET}`);
  for (const file of files) {
    const name =
      (file.fileName as string) ?? (file.sourcePath as string) ?? "-";
    const size = file.fileSize ?? file.size;
    const sizeStr =
      size != null ? `  ${FG_GRAY}${formatSize(Number(size))}${RESET}` : "";
    const discTag = file.isDisc ? ` ${FG_YELLOW}DISC${RESET}` : "";
    const icon = file.isDirectory ? "📁" : "📄";
    lines.push(
      `${DIM}  │${RESET} ${icon} ${FG_WHITE}${name}${RESET}${sizeStr}${discTag}`,
    );
  }
  lines.push(`${DIM}  └──${RESET}`);
  return lines.join("\r\n");
}

// ─── Run divider ───────────────────────────────────────

function formatDivider(label: string, iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const time = formatTimestamp(iso);
    const dateStr = isToday
      ? time
      : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${time}`;
    return `\r\n${DIM}──── ${label} · ${dateStr} ────${RESET}\r\n`;
  } catch {
    return `\r\n${DIM}──── ${label} ────${RESET}\r\n`;
  }
}

// ─── Public: Subscription log formatter ────────────────

export function formatSubscriptionLogEntry(
  entry: SubscriptionLogEntry,
  index: number,
): string {
  const lines: string[] = [];

  // Run start divider
  if (index === 0) {
    lines.push(formatDivider("开始执行", entry.timestamp));
  }

  const ts = `${DIM}${formatTimestamp(entry.timestamp)}${RESET}`;
  const phase = formatPhaseTag(
    entry.phase,
    subscriptionPhaseColors,
    subscriptionPhaseLabels,
  );
  const msgColor = entry.phase === "error" ? FG_RED : FG_WHITE;
  const msg = `${msgColor}${entry.message}${RESET}`;

  lines.push(`${ts} ${phase} ${msg}`);

  // Structured details
  const details = entry.details as Record<string, unknown> | null;
  if (details) {
    // Torrent list
    if (Array.isArray(details.torrents) && details.torrents.length > 0) {
      lines.push(formatTorrentList(details.torrents as TorrentDetail[]));
    }
    // File structure
    if (
      Array.isArray(details.fileStructure) &&
      details.fileStructure.length > 0
    ) {
      lines.push(
        formatFileStructure(
          details.fileStructure as FileStructureItem[],
          (details.totalSize as number) ?? 0,
          (details.selectedSize as number) ?? 0,
        ),
      );
    }
  }

  return lines.join("\r\n");
}

// ─── Public: Download log formatter ────────────────────

export function formatDownloadLogEntry(
  entry: DownloadLogEntry,
  index: number,
  prevEntry: DownloadLogEntry | null,
): string {
  const lines: string[] = [];

  // Run dividers
  if (index === 0) {
    lines.push(formatDivider("开始执行", entry.timestamp));
  } else if (prevEntry && prevEntry.runId !== entry.runId) {
    lines.push(formatDivider("重新执行", entry.timestamp));
  }

  const ts = `${DIM}${formatTimestamp(entry.timestamp)}${RESET}`;
  const phase = formatPhaseTag(
    entry.phase,
    downloadPhaseColors,
    downloadPhaseLabels,
  );
  const msgColor = entry.phase === "error" ? FG_RED : FG_WHITE;
  const msg = `${msgColor}${entry.message}${RESET}`;

  // organize-execute status indicator
  const details = entry.details as Record<string, unknown> | null;
  let statusIcon = "";
  if (entry.phase === "organize-execute" && details) {
    statusIcon =
      details.status === "success"
        ? ` ${FG_GREEN}✓${RESET}`
        : ` ${FG_RED}✗${RESET}`;
  }

  lines.push(`${ts} ${phase} ${msg}${statusIcon}`);

  // File list for organize-scan
  if (details && entry.phase === "organize-scan") {
    if (Array.isArray(details.files) && details.files.length > 0) {
      lines.push(
        formatFilesList(details.files as Array<Record<string, unknown>>),
      );
    }
  }

  // Generic details (skip already-rendered keys)
  if (details) {
    const filtered = Object.fromEntries(
      Object.entries(details).filter(([key]) => key !== "files"),
    );
    if (Object.keys(filtered).length > 0) {
      const detailsStr = formatDetails(filtered);
      if (detailsStr) lines.push(detailsStr);
    }
  }

  return lines.join("\r\n");
}
