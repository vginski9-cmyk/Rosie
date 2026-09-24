"use client";
import { dec } from "@/lib/format";

// Workbook-style pivot charts (vertical grouped columns) — the "FTEs per Week"
// sheet's visuals, actionable: every cap carries its number, bands mirror the
// pivot's row hierarchy (Year → Semester → leaf), and the two series are the
// validated faculty-blue / preceptor-orange pair.
//
// ONE GRID: the columns, their labels, the semester (group) labels and the year
// (band) labels are rows of the same CSS grid, one track per leaf — so a label
// always sits under its own column and a semester or year spans exactly the
// columns it names, whatever a value label or a long name does to a column's
// width. A boundary between semesters or years is a border on the FIRST cell of
// the new group or band in EVERY row, so the line runs unbroken from the bars
// down through the year label.

export interface ColSeries { name: string; color: string }
export interface ColLeaf { label: string; values: number[]; title?: string; /** Identifies the leaf to a click handler. */ key?: string }
export interface ColGroup { label: string; sub?: string; leaves: ColLeaf[] }
export interface ColBand { label: string; groups: ColGroup[] }

const fmtV = (v: number) => {
  if (v === 0) return "0";
  return dec(v);
};

/** The boundary a leaf opens: a new year (band), a new semester (group), or nothing. */
type Edge = "band" | "group" | null;
const EDGE_CLASS: Record<Exclude<Edge, null>, string> = { band: "border-l-2 border-slate-500", group: "border-l border-slate-400" };
const edgeClass = (e: Edge) => (e ? EDGE_CLASS[e] : "");

export function ColumnChart({
  bands, series, height = 150, leafMinWidth = 40, vertLeafLabels = false, unit, onLeafClick, activeKey,
}: {
  bands: ColBand[];
  series: ColSeries[];
  height?: number;
  leafMinWidth?: number;
  /** Rotate leaf labels 90° (long names, e.g. rotation types). */
  vertLeafLabels?: boolean;
  unit?: string;
  /** Click a column to drill into it (who fills it). */
  onLeafClick?: (leaf: ColLeaf) => void;
  /** The leaf currently drilled into — drawn highlighted. */
  activeKey?: string | null;
}) {
  // Every leaf in order, with the boundary it opens and its position in the grid.
  const cells: { leaf: ColLeaf; edge: Edge; col: number }[] = [];
  const groupCells: { group: ColGroup; edge: Edge; col: number; span: number }[] = [];
  const bandCells: { band: ColBand; edge: Edge; col: number; span: number }[] = [];
  let col = 1;
  bands.forEach((b, bi) => {
    const bandStart = col;
    b.groups.forEach((g, gi) => {
      const groupStart = col;
      g.leaves.forEach((l, li) => {
        const edge: Edge = li > 0 ? null : gi > 0 ? "group" : bi > 0 ? "band" : null;
        cells.push({ leaf: l, edge, col });
        col++;
      });
      if (g.leaves.length) groupCells.push({ group: g, edge: gi > 0 ? "group" : bi > 0 ? "band" : null, col: groupStart, span: g.leaves.length });
    });
    const span = col - bandStart;
    if (span) bandCells.push({ band: b, edge: bi > 0 ? "band" : null, col: bandStart, span });
  });
  const n = cells.length;
  const max = Math.max(0.001, ...cells.flatMap((c) => c.leaf.values));
  if (!n) return <p className="text-xs text-slate-400">Nothing in this slice.</p>;
  const showGroups = groupCells.some((g) => g.group.label);
  const showBands = bandCells.some((b) => b.band.label);

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
        <div className="grid min-w-full" style={{ gridTemplateColumns: `repeat(${n}, minmax(${leafMinWidth}px, auto))` }}>
          {/* Row 1 — the columns */}
          {cells.map(({ leaf: l, edge, col: c }) => (
            <div key={`p${c}`} role={onLeafClick ? "button" : undefined} tabIndex={onLeafClick ? 0 : undefined} onClick={onLeafClick ? () => onLeafClick(l) : undefined} onKeyDown={onLeafClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onLeafClick(l); } } : undefined}
              className={`flex flex-col justify-end border-b border-slate-400 px-1 ${edgeClass(edge)} ${onLeafClick ? "cursor-pointer rounded-t hover:bg-rose-50/70" : ""} ${activeKey && l.key === activeKey ? "bg-rose-50 ring-2 ring-rose-400" : ""}`}
              style={{ gridColumn: c, gridRow: 1 }} title={onLeafClick ? `${l.title ?? l.label} — click to see who fills it` : undefined}>
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
          {/* Row 2 — leaf labels, each under its own column */}
          {cells.map(({ leaf: l, edge, col: c }) => (
            <div key={`l${c}`} className={`flex items-start justify-center px-1 pt-1 ${edgeClass(edge)}`} style={{ gridColumn: c, gridRow: 2 }}>
              {vertLeafLabels
                ? <span className="text-[10px] leading-tight text-slate-500" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", maxHeight: 110 }} title={l.label}>{l.label}</span>
                : <span className="truncate text-[10px] text-slate-500" title={l.label}>{l.label}</span>}
            </div>
          ))}
          {/* Row 3 — group (semester) labels, each spanning exactly its columns */}
          {showGroups && groupCells.map(({ group: g, edge, col: c, span }) => (
            <div key={`g${c}`} className={`border-t border-slate-200 px-1 py-0.5 text-center text-[10px] font-medium text-slate-600 ${edgeClass(edge)}`} style={{ gridColumn: `${c} / span ${span}`, gridRow: 3 }}>
              {g.label}
              {g.sub && <span className="block text-[9px] font-normal tabular-nums text-slate-400">{g.sub}</span>}
            </div>
          ))}
          {/* Row 4 — band (year) labels, each spanning exactly its columns */}
          {showBands && bandCells.map(({ band: b, edge, col: c, span }) => (
            <div key={`b${c}`} className={`border-t border-slate-300 px-1 py-0.5 text-center text-[11px] font-semibold text-slate-700 ${edgeClass(edge)}`} style={{ gridColumn: `${c} / span ${span}`, gridRow: showGroups ? 4 : 3 }}>
              {b.label}
            </div>
          ))}
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
