"use client";

// One session, every workbook column (A–AE), full headers, no scrolling — the
// editing surface shared by the template sheet, the per-offering sheet and the
// add-session form. Blue = input, green = live formula, grey = set by the
// sequence. Drop-downs where the workbook expects a choice; every drop-down
// lets you add your own option.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SESSION_FIELDS, FORM_FIELDS, KIND_LABELS, type EditableField, type SessionField } from "@/lib/sessionfields";
import { computeColumns, type SessionInput, type WorkloadAssumptions } from "@/lib/capacitymodel";

export type FieldRow = Record<EditableField, string | number | null>;

const num = (v: number | null, dp = 2) => (v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: dp }));

/** Options people added themselves, remembered in this browser per field. */
function useExtraOptions(key: string): [string[], (v: string) => void] {
  const [extra, setExtra] = useState<string[]>([]);
  useEffect(() => { try { const raw = localStorage.getItem(`rosie-options:${key}`); if (raw) setExtra(JSON.parse(raw)); } catch { /* none */ } }, [key]);
  const add = (v: string) => setExtra((p) => { const n = p.includes(v) ? p : [...p, v]; try { localStorage.setItem(`rosie-options:${key}`, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  return [extra, add];
}

/** A drop-down that also takes a new value: pick one, or "+ add" and type it. */
export function PickOrType({ value, options, optionKey, onChange, labels, className }: {
  value: string | null; options: readonly string[]; optionKey: string;
  onChange: (v: string | null) => void; labels?: Record<string, string>; className?: string;
}) {
  const [extra, addExtra] = useExtraOptions(optionKey);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const all = useMemo(() => { const s = new Set<string>([...options, ...extra]); if (value && !s.has(value)) s.add(value); return [...s]; }, [options, extra, value]);
  if (typing) {
    const commit = () => { const v = draft.trim(); if (v) { addExtra(v); onChange(v); } setTyping(false); setDraft(""); };
    return (
      <span className="flex gap-1">
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") setTyping(false); }} placeholder="type the new option" className={className} />
        <button type="button" onClick={commit} className="rounded bg-rose-600 px-2 text-[11px] font-medium text-white">Add</button>
        <button type="button" onClick={() => setTyping(false)} className="rounded border border-slate-300 px-1.5 text-[11px] text-slate-500">×</button>
      </span>
    );
  }
  return (
    <select value={value ?? ""} onChange={(e) => { if (e.target.value === "__new__") { setTyping(true); return; } onChange(e.target.value || null); }} className={className}>
      <option value="">—</option>
      {all.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
      <option value="__new__">+ Add a new option…</option>
    </select>
  );
}

export const FIELD_INPUT = "w-full rounded border border-blue-200 bg-blue-50/70 px-1.5 py-1 text-xs text-blue-900 focus:bg-white focus:outline-blue-500";

/** Full-header label for one workbook column. */
export function FieldLabel({ f }: { f: SessionField }) {
  return (
    <span className="block text-[10px] font-semibold leading-tight text-slate-500" title={f.hint ?? f.header}>
      <span className="mr-1 rounded bg-slate-100 px-1 font-mono text-[9px] text-emerald-700">{f.col}</span>{f.header}
    </span>
  );
}

/** Every column of one session as labeled cells: sequence (grey), inputs
 *  (blue, with drop-downs), formulas (green, recomputed as you type). */
export function SessionFieldGrid({ row, seq, enrollment, assumptions, onChange, before, after, editableKind = true, dataOptions = {} }: {
  row: FieldRow;
  /** Sequence-derived columns: A term, B semester, D code, E title, G number. */
  seq: { A: string; B: string; D: string; E: string; G: string };
  enrollment: number;
  assumptions: WorkloadAssumptions;
  onChange: (field: EditableField, value: string | number | null) => void;
  before?: ReactNode;
  after?: ReactNode;
  /** The template lets you change the session type; an offering keeps it. */
  editableKind?: boolean;
  /** Values already used across the program — they join the drop-downs. */
  dataOptions?: Partial<Record<EditableField, string[]>>;
}) {
  const comp = computeColumns(row as unknown as SessionInput, enrollment, assumptions);
  const calcVal: Record<string, string> = {
    C: num(comp.C, 1), X: num(comp.X), Y: comp.divByZero ? "#DIV/0!" : num(comp.Y, 0), Z: num(comp.Z),
    AA: num(comp.AA), AB: num(comp.AB), AC: num(comp.AC), AD: num(comp.AD, 3), AE: num(comp.AE),
  };
  return (
    <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {before}
      {SESSION_FIELDS.map((f) => {
        if (f.kind === "seq") return <div key={f.col}><FieldLabel f={f} /><span className="mt-0.5 block rounded bg-slate-50 px-1.5 py-1 text-xs text-slate-700">{seq[f.col as keyof typeof seq]}</span></div>;
        if (f.kind === "calc") {
          const err = f.col !== "C" && comp.divByZero;
          return (
            <div key={f.col}>
              <FieldLabel f={f} />
              <span className={`mt-0.5 block rounded px-1.5 py-1 text-right font-mono text-xs tabular-nums ${f.col === "C" ? "bg-rose-50 font-semibold text-rose-800" : err ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-900"}`}>{calcVal[f.col]}</span>
              <span className="block truncate text-[9px] text-slate-400" title={f.hint}>{f.hint}</span>
            </div>
          );
        }
        const field = f.field!;
        const v = row[field];
        const wide = f.wide ? "sm:col-span-2" : "";
        let control: ReactNode;
        if (field === "kind") {
          control = editableKind
            ? <select value={String(v ?? "CLASS")} onChange={(e) => onChange("kind", e.target.value)} className={FIELD_INPUT}>{(["CLASS", "LAB", "CLINICAL"] as const).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}</select>
            : <span className="mt-0.5 block rounded bg-slate-50 px-1.5 py-1 text-xs text-slate-700">{KIND_LABELS[String(v) as keyof typeof KIND_LABELS] ?? String(v ?? "")}</span>;
        } else if (f.input === "select") {
          control = <PickOrType value={(v as string | null) ?? null} options={[...(f.options ?? []), ...(dataOptions[field] ?? [])]} optionKey={field} onChange={(nv) => onChange(field, nv)} className={FIELD_INPUT} />;
        } else if (f.input === "number") {
          const listId = f.options ? `quick-${field}` : undefined;
          control = (
            <>
              <input type="number" step={f.step ?? "any"} list={listId} value={(v as number | null) ?? ""} onChange={(e) => onChange(field, e.target.value === "" ? null : Number(e.target.value))} className={`${FIELD_INPUT} text-right font-mono`} />
              {listId && <datalist id={listId}>{f.options!.map((o) => <option key={o} value={o} />)}</datalist>}
            </>
          );
        } else if (f.input === "textarea") {
          control = <textarea rows={2} value={(v as string | null) ?? ""} onChange={(e) => onChange(field, e.target.value || null)} className={FIELD_INPUT} />;
        } else {
          control = <input value={(v as string | null) ?? ""} onChange={(e) => onChange(field, e.target.value || null)} className={FIELD_INPUT} />;
        }
        return <label key={f.col} className={`block ${wide}`}><FieldLabel f={f} />{control}</label>;
      })}
      {after}
    </div>
  );
}

/** Hidden mirrors of a row so a server-action form submits exactly what's shown. */
export function HiddenSessionFields({ row }: { row: FieldRow }) {
  return <>{FORM_FIELDS.map((f) => <input key={f} type="hidden" name={f} value={row[f] == null ? "" : String(row[f])} readOnly />)}</>;
}

/** Drop-down choices harvested from what the program already uses. */
export function harvestOptions(rows: Partial<FieldRow>[]): Partial<Record<EditableField, string[]>> {
  const out: Partial<Record<EditableField, string[]>> = {};
  for (const f of ["deliveryMode", "location", "rotationType", "clinicalMode"] as EditableField[]) {
    const s = new Set<string>();
    for (const r of rows) { const v = r[f]; if (typeof v === "string" && v.trim()) s.add(v.trim()); }
    out[f] = [...s].sort();
  }
  return out;
}
