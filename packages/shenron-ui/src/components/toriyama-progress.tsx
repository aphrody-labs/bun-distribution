/**
 * ToriyamaProgress — Ki Energy & Battle Charge Progress Bar Primitive.
 * Features comic cell-shading, sparkling Ki aura gradient, and authentic ink borders.
 */

export interface ToriyamaProgressProps {
  value?: number;
  max?: number;
  variant?: "ki" | "scouter" | "majin" | "capsule";
  showLabel?: boolean;
  label?: string;
  className?: string;
}

const PROGRESS_STYLES = {
  ki: {
    bar: "bg-gradient-to-r from-[var(--color-toriyama-orange,#f85b1a)] via-[var(--color-toriyama-gold,#ffd700)] to-white",
    glow: "shadow-[0_0_10px_rgba(255,215,0,0.6)]",
    text: "text-[var(--color-toriyama-gold,#ffd700)]",
  },
  scouter: {
    bar: "bg-[var(--color-toriyama-scouter-green,#00ff66)]",
    glow: "shadow-[0_0_10px_rgba(0,255,102,0.6)]",
    text: "text-[var(--color-toriyama-scouter-green,#00ff66)]",
  },
  majin: {
    bar: "bg-gradient-to-r from-[#5a189a] via-[#f72585] to-white",
    glow: "shadow-[0_0_10px_rgba(247,37,133,0.6)]",
    text: "text-[#f72585]",
  },
  capsule: {
    bar: "bg-gradient-to-r from-[var(--color-toriyama-blue,#0077b6)] to-[var(--color-toriyama-capsule,#00b4d8)]",
    glow: "shadow-[0_0_10px_rgba(0,180,216,0.6)]",
    text: "text-[var(--color-toriyama-capsule,#00b4d8)]",
  },
};

export function ToriyamaProgress({
  value = 0,
  max = 100,
  variant = "ki",
  showLabel = true,
  label = "Charge de Ki",
  className = "",
}: ToriyamaProgressProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const clamped = Number.isFinite(value) ? Math.min(safeMax, Math.max(0, value)) : 0;
  const percentage = Math.round((clamped / safeMax) * 100);
  const style = PROGRESS_STYLES[variant] ?? PROGRESS_STYLES.ki;

  return (
    <div className={`flex flex-col gap-1.5 select-none ${className}`}>
      {showLabel && (
        <div className="flex justify-between items-center text-xs font-bold uppercase tracking-wider">
          <span className="text-[var(--color-muted-foreground)]">{label}</span>
          <span className={`font-mono font-black ${style.text}`}>{percentage}%</span>
        </div>
      )}
      <div
        className="w-full h-4 bg-[#18181b] border-2 border-[var(--color-toriyama-ink,#121417)] shadow-[2px_2px_0px_var(--color-toriyama-ink,#121417)] p-0.5 overflow-hidden"
        role="progressbar"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={safeMax}
      >
        <div
          className={`h-full transition-all duration-300 ${style.bar} ${style.glow}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
