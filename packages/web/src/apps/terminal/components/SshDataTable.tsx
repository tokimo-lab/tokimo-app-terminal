/**
 * Unified data-table primitive shared by all SSH panels (process / storage /
 * network / docker). Virtualized via ScrollArea, grid-based rows, sortable
 * headers, optional search + refresh toolbar.
 *
 * Visual baseline matches SshProcessList: small text-xs font-mono rows,
 * text-fg-secondary with subtle hover, row height 24px.
 */
import { cn, Input, ScrollArea } from "@tokiomo/components";
import { RefreshCw, Search } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
} from "react";

export const SSH_TABLE_ROW_HEIGHT = 24;

export interface SshColumn<T> {
  key: string;
  header: ReactNode;
  /** CSS grid column size, e.g. "80px", "1fr", "minmax(0,1fr)" */
  width: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  compare?: (a: T, b: T) => number;
  /** Cell content renderer */
  render: (row: T, index: number) => ReactNode;
  /** Override cell className (default: "px-2 truncate [text-right tabular-nums]") */
  cellClassName?: string;
}

export interface SshDataTableProps<T> {
  items: T[];
  columns: SshColumn<T>[];
  getRowKey: (row: T) => string | number;
  loading?: boolean;
  rowHeight?: number;
  emptyText?: ReactNode;
  loadingText?: ReactNode;
  noMatchText?: ReactNode;

  // Toolbar — omit all of these to hide toolbar entirely
  /** Leftmost label in the toolbar (e.g. "1234 个进程"). */
  countLabel?: (visible: number, total: number, filtered: boolean) => ReactNode;
  /** Renders raw content as the leftmost toolbar slot (overrides countLabel). */
  toolbarLeft?: ReactNode;
  /** Extra slot before the refresh button. */
  toolbarRight?: ReactNode;
  onRefresh?: () => void;

  // Search
  searchable?: boolean;
  searchPlaceholder?: string;
  filterFn?: (row: T, query: string) => boolean;

  // Default sort
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";

  onRowContextMenu?: (e: React.MouseEvent, row: T) => void;
  onRowClick?: (e: React.MouseEvent, row: T) => void;

  className?: string;
}

export function SshDataTable<T>({
  items,
  columns,
  getRowKey: _getRowKey,
  loading = false,
  rowHeight = SSH_TABLE_ROW_HEIGHT,
  emptyText = "暂无数据",
  loadingText = "加载中...",
  noMatchText = "无匹配结果",
  countLabel,
  toolbarLeft,
  toolbarRight,
  onRefresh,
  searchable = false,
  searchPlaceholder = "搜索",
  filterFn,
  defaultSortKey,
  defaultSortDir = "desc",
  onRowContextMenu,
  onRowClick,
  className,
}: SshDataTableProps<T>) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [sortKey, setSortKey] = useState<string | undefined>(defaultSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);

  const gridTemplate = useMemo(
    () => columns.map((c) => c.width).join(" "),
    [columns],
  );

  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let rows = q && filterFn ? items.filter((r) => filterFn(r, q)) : items;
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col?.compare) {
        const dir = sortDir === "asc" ? 1 : -1;
        const cmp = col.compare;
        rows = [...rows].sort((a, b) => cmp(a, b) * dir);
      }
    }
    return rows;
  }, [items, deferredQuery, sortKey, sortDir, columns, filterFn]);

  const handleSort = useCallback((key: string) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return key;
      }
      setSortDir("desc");
      return key;
    });
  }, []);

  const filtered = deferredQuery.trim().length > 0;
  const showToolbar =
    searchable ||
    onRefresh != null ||
    toolbarLeft != null ||
    toolbarRight != null ||
    countLabel != null;

  const renderRow = useCallback(
    (index: number) => {
      const row = visible[index];
      if (row == null) return null;
      return (
        // biome-ignore lint/a11y/noStaticElementInteractions: row-level context menu / click only
        // biome-ignore lint/a11y/useKeyWithClickEvents: table rows use context menu; keyboard nav not required
        <div
          className={cn(
            "grid items-center h-full text-fg-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.04] cursor-default",
            onRowClick && "cursor-pointer",
          )}
          style={{ gridTemplateColumns: gridTemplate }}
          onContextMenu={
            onRowContextMenu ? (e) => onRowContextMenu(e, row) : undefined
          }
          onClick={onRowClick ? (e) => onRowClick(e, row) : undefined}
        >
          {columns.map((col) => (
            <div
              key={col.key}
              className={
                col.cellClassName ??
                cn(
                  "px-2 truncate",
                  col.align === "right" && "text-right tabular-nums",
                  col.align === "center" && "text-center",
                )
              }
            >
              {col.render(row, index)}
            </div>
          ))}
        </div>
      );
    },
    [visible, columns, gridTemplate, onRowContextMenu, onRowClick],
  );

  return (
    <div className={cn("flex flex-col h-full overflow-hidden", className)}>
      {showToolbar && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-black/[0.08] dark:border-zinc-800/60 shrink-0">
          {(toolbarLeft || countLabel) && (
            <div className="text-xs text-fg-muted whitespace-nowrap">
              {toolbarLeft ??
                countLabel?.(visible.length, items.length, filtered)}
            </div>
          )}
          <div className="flex-1 min-w-0 flex items-center justify-end gap-2">
            {searchable && (
              <div className="w-64 min-w-0">
                <Input
                  size="small"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  prefix={<Search />}
                  allowClear
                />
              </div>
            )}
            {toolbarRight}
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="p-0.5 text-fg-muted hover:text-fg-secondary transition-colors cursor-pointer"
                title="刷新"
              >
                <RefreshCw
                  className={cn("h-3 w-3", loading && "animate-spin")}
                />
              </button>
            )}
          </div>
        </div>
      )}

      <div
        className="grid text-xs font-mono text-fg-secondary bg-surface-elevated border-b border-black/[0.08] dark:border-zinc-800/60 shrink-0"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {columns.map((col) => {
          const isActive = sortKey === col.key;
          const indicator = isActive ? (sortDir === "asc" ? " ▲" : " ▼") : "";
          if (col.sortable) {
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => handleSort(col.key)}
                className={cn(
                  "px-2 py-1 font-normal cursor-pointer hover:text-fg-primary transition-colors whitespace-nowrap select-none",
                  col.align === "right" ? "text-right" : "text-left",
                  isActive && "text-fg-primary",
                )}
              >
                {col.header}
                {indicator}
              </button>
            );
          }
          return (
            <div
              key={col.key}
              className={cn(
                "px-2 py-1 whitespace-nowrap select-none",
                col.align === "right" ? "text-right" : "text-left",
              )}
            >
              {col.header}
            </div>
          );
        })}
      </div>

      {loading && visible.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-fg-muted">
          {loadingText}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-fg-muted">
          {items.length === 0 ? emptyText : noMatchText}
        </div>
      ) : (
        <ScrollArea
          className="flex-1 min-h-0 text-xs font-mono"
          direction="vertical"
          itemCount={visible.length}
          itemHeight={rowHeight}
          renderItem={renderRow}
          overscan={8}
        />
      )}
    </div>
  );
}
