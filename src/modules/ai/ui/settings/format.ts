export function fmtContextWindow(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return `${value}`;
}

export function fmtPrice(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(3)}`;
}

export function maskApiKey(key: string | null): string {
  if (!key) return "未设置";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}
