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
