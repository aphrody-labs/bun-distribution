const UNITS = ["o", "Ko", "Mo", "Go", "To"] as const;

export function formatBytes(bytes: number): string {
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text =
    unit === 0
      ? String(Math.round(value))
      : value.toFixed(value >= 100 ? 0 : 1);
  return `${bytes < 0 ? "-" : ""}${text} ${UNITS[unit]}`;
}
