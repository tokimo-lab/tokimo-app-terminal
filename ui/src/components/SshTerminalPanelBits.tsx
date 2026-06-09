import type React from "react";

interface TabButtonProps {
  active: boolean;
  collapsed: boolean;
  onClick: (e: React.MouseEvent) => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}

export function TabButton({
  active,
  collapsed,
  onClick,
  icon,
  label,
  badge,
}: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-1 px-3 py-1 text-xs transition-colors cursor-pointer ${
        active && !collapsed
          ? "text-[var(--accent-text)] border-b-2 border-[var(--accent)] -mb-px"
          : "text-fg-muted hover:text-fg-secondary"
      }`}
    >
      {icon}
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-0.5 inline-flex items-center justify-center min-w-[14px] h-3.5 px-0.5 rounded-full bg-blue-500 text-white text-[9px] font-bold leading-none">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

interface StatGaugeProps {
  label: string;
  percent: number;
  color: "emerald" | "blue";
  detail?: string;
}

export function StatGauge({ label, percent, color, detail }: StatGaugeProps) {
  const barColor =
    percent > 80
      ? "bg-red-500"
      : color === "emerald"
        ? "bg-emerald-500"
        : "bg-blue-500";

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-fg-muted">{label}</span>
      <div className="w-16 h-1.5 bg-black/[0.10] dark:bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-500`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className="text-fg-secondary tabular-nums w-9 text-right">
        {percent.toFixed(0)}%
      </span>
      {detail && <span className="text-fg-muted text-[10px]">{detail}</span>}
    </div>
  );
}
