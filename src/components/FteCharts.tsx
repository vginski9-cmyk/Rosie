"use client";

// Workbook-style pivot charts (vertical grouped columns) — the "FTEs per Week"
// sheet's visuals, actionable: every cap carries its number, bands mirror the
// pivot's row hierarchy (Year → Semester → leaf), and the two series are the
// validated faculty-blue / preceptor-orange pair.

export interface ColSeries { name: string; color: string }
export interface ColLeaf { label: string; values: number[]; title?: string }
export interface ColGroup { label: string; sub?: string; leaves: ColLeaf[] }
export interface ColBand { label: string; groups: ColGroup[] }

const fmtV = (v: number) => {
  if (v === 0) return "0";
  if (v < 10) return (Math.round(v * 10) / 10).toString();
  return Math.round(v).toLocaleString();
};

export function ColumnChart({
  bands, series, height = 150, leafMinWidth = 40, vertLeafLabels = false, unit,
}: {
  bands: ColBand[];
  series: ColSeries[];
  height?: number;
  leafMinWidth?: number;
  /** Rotate leaf labels 90° (long names, e.g. rotation types). */
  vertLeafLabels?: boolean;
  unit?: string;
}) {
  const leaves = bands.flatMap((b) => b.groups.flatMap((g) => g.leaves));
  const max = Math.max(0.001, ...leaves.flatMap((l) => l.values));
  if (!leaves.length) return <p className="text-xs text-slate-400">Nothing in this slice.</p>;

  return (
    <div>
      {/* Legend — identity never rides on color alone (single series: the title carries it) */}
      {series.length >= 2 && (
        <div className="mb-2 flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.name}{unit ? ` (${unit})` : ""}
            </span>
          ))}
        </div>
      )}
      <div className="overflow-x-auto pb-1">
        <div className="inline-block min-w-full">
          {/* Plot row */}
          <div className="flex items-stretch border-b border-slate-300">
            {bands.map((b, bi) => (
              <div key={bi} className={`flex ${bi > 0 ? "border-l border-slate-200" : ""}`}>
                {b.groups.map((g, gi) => (
                  <div key={gi} className={`flex ${gi > 0 ? "border-l border-slate-100" : ""}`}>
                    {g.leaves.map((l, li) => (
                      <div key={li} className="flex flex-col justify-end px-1" style={{ minWidth: leafMinWidth }}>
                        <div className="flex items-end justify-center gap-[2px]" style={{ height }}>
                          {series.map((s, si) => {
                            const v = l.values[si] ?? 0;
                            const h = Math.round((v / max) * (height - 16));
                            return (
                              <div key={si} className="flex w-full max-w-[24px] flex-col items-center justify-end" title={`${l.title ?? l.label} — ${s.name}: ${fmtV(v)}${unit ? ` ${unit}` : ""}`}>
                                {v > 0 && <span className="mb-0.5 text-[9px] font-medium tabular-nums leading-none text-slate-600">{fmtV(v)}</span>}
                                <div className="w-full rounded-t-[4px]" style={{ height: Math.max(v > 0 ? 2 : 0, h), background: s.color }} />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {/* Leaf labels */}
          <div className="flex">
            {bands.map((b, bi) => (
              <div key={bi} className={`flex ${bi > 0 ? "border-l border-slate-200" : ""}`}>
                {b.groups.map((g, gi) => (
                  <div key={gi} className={`flex ${gi > 0 ? "border-l border-slate-100" : ""}`}>
                    {g.leaves.map((l, li) => (
                      <div key={li} className="flex items-start justify-center px-1 pt-1" style={{ minWidth: leafMinWidth }}>
                        {vertLeafLabels
                          ? <span className="text-[10px] leading-tight text-slate-500" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", maxHeight: 110 }} title={l.label}>{l.label}</span>
                          : <span className="truncate text-[10px] text-slate-500" title={l.label}>{l.label}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {/* Group band labels */}
          {bands.some((b) => b.groups.some((g) => g.label)) && (
            <div className="flex border-t border-slate-100">
              {bands.map((b, bi) => (
                <div key={bi} className={`flex ${bi > 0 ? "border-l border-slate-200" : ""}`}>
                  {b.groups.map((g, gi) => (
                    <div key={gi} className={`px-1 py-0.5 text-center text-[10px] font-medium text-slate-600 ${gi > 0 ? "border-l border-slate-100" : ""}`} style={{ minWidth: g.leaves.length * leafMinWidth }}>
                      {g.label}
                      {g.sub && <span className="block text-[9px] font-normal tabular-nums text-slate-400">{g.sub}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {/* Top band labels */}
          {bands.some((b) => b.label) && (
            <div className="flex border-t border-slate-200">
              {bands.map((b, bi) => (
                <div key={bi} className={`px-1 py-0.5 text-center text-[11px] font-semibold text-slate-700 ${bi > 0 ? "border-l border-slate-200" : ""}`} style={{ minWidth: b.groups.reduce((n, g) => n + g.leaves.length, 0) * leafMinWidth }}>
                  {b.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Series colors: validated categorical pair — faculty blue, preceptor orange. */
export const FAC_COLOR = "#2a78d6";
export const PRE_COLOR = "#eb6834";
/** Session-type columns (validated triple). */
export const KIND_COLORS: Record<string, string> = { CLASS: "#0284c7", LAB: "#7c3aed", CLINICAL: "#e11d48" };
