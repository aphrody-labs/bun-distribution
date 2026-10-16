interface Props {
  pending: number;
  reactivated: number;
  churned: number;
  grandfathered?: number;
}

export function MigrationChart({ pending, reactivated, churned, grandfathered = 0 }: Props) {
  const total = pending + reactivated + churned + grandfathered;
  if (total === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        Aucun membre encore importé
      </div>
    );
  }

  const segments = [
    {
      color: "#5fa893",
      label: "Réactivés",
      pct: (reactivated / total) * 100,
      value: reactivated,
    },
    {
      color: "#aac9d9",
      label: "Grandfathered",
      pct: (grandfathered / total) * 100,
      value: grandfathered,
    },
    {
      color: "#c9a958",
      label: "En attente",
      pct: (pending / total) * 100,
      value: pending,
    },
    {
      color: "#e54a4a",
      label: "Churn",
      pct: (churned / total) * 100,
      value: churned,
    },
  ].filter(s => s.value > 0);

  return (
    <div className="space-y-4">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {segments.map(s => (
          <div
            key={s.label}
            className="h-full transition-all"
            style={{ backgroundColor: s.color, width: `${s.pct}%` }}
            title={`${s.label}: ${s.value} (${s.pct.toFixed(1)}%)`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        {segments.map(s => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-bold text-foreground">{s.value}</span>
            <span className="text-xs text-muted-foreground/70">{s.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
