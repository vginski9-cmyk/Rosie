export const fmt = {
  num(n: number | null | undefined, digits = 0): string {
    if (n == null || Number.isNaN(n)) return "—";
    return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  },
  pct(n: number | null | undefined, digits = 0): string {
    if (n == null || Number.isNaN(n)) return "—";
    return `${(n * 100).toLocaleString(undefined, { maximumFractionDigits: digits })}%`;
  },
  fte(n: number | null | undefined): string {
    if (n == null || Number.isNaN(n)) return "—";
    return n.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  },
};
