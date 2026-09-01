"use client";

import { useEffect, useState } from "react";
import {
  CAPACITY_HEADERS, CAPACITY_FORMULAS, computeColumns,
  type SessionInput, type WorkloadAssumptions,
} from "@/lib/capacitymodel";
import { updateSession, deleteSession } from "@/lib/actions";

// The Raw Data & Calculations session table, one course at a time — the exact
// column set and headers from the clinical capacity workbook (A2:AE…), with
// blue editable input cells and green live-formula cells. Edits recalculate
// the row instantly; Save commits the row to the template, and every other
// surface (offerings, calendars, insights) reads the same rows.

export interface SheetSession extends SessionInput {
  startTime: string | null;
}

const num = (v: number | null, dp = 2) =>
  v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: dp });

// Column model: [key, header, kind] — kind: "seq" (sequence-derived, green),
// "edit" (blue input), "calc" (green formula).
// Exported so the per-offering sheet (OfferingDesign) renders the EXACT same
// workbook schema — same columns, same headers, same order.
export type ColKind = "seq" | "edit" | "calc";
export interface Col { c: string; kind: ColKind; w?: string }
export const SHEET_COLS: Col[] = [
  { c: "A", kind: "seq", w: "5.2rem" }, { c: "B", kind: "seq", w: "6.5rem" }, { c: "C", kind: "calc", w: "5rem" },
  { c: "D", kind: "seq", w: "5.5rem" }, { c: "E", kind: "seq", w: "9rem" },
  { c: "F", kind: "edit", w: "5.5rem" }, { c: "G", kind: "seq", w: "4.4rem" }, { c: "H", kind: "edit", w: "13rem" },
  { c: "I", kind: "edit", w: "6.5rem" }, { c: "J", kind: "edit", w: "6.5rem" },
  { c: "K", kind: "edit", w: "4.6rem" }, { c: "L", kind: "edit", w: "4.6rem" }, { c: "M", kind: "edit", w: "4.6rem" },
  { c: "N", kind: "edit", w: "4.6rem" }, { c: "O", kind: "edit", w: "4.6rem" }, { c: "P", kind: "edit", w: "4.6rem" },
  { c: "Q", kind: "edit", w: "4.4rem" }, { c: "R", kind: "edit", w: "6rem" }, { c: "S", kind: "edit", w: "11rem" },
  { c: "T", kind: "edit", w: "4.6rem" }, { c: "U", kind: "edit", w: "4.6rem" },
  { c: "V", kind: "edit", w: "7.5rem" }, { c: "W", kind: "edit", w: "6.5rem" },
  { c: "X", kind: "calc", w: "4.8rem" }, { c: "Y", kind: "calc", w: "4.8rem" }, { c: "Z", kind: "calc", w: "4.8rem" },
  { c: "AA", kind: "calc", w: "5.2rem" }, { c: "AB", kind: "calc", w: "5.2rem" },
  { c: "AC", kind: "calc", w: "4.8rem" }, { c: "AD", kind: "calc", w: "5.2rem" }, { c: "AE", kind: "calc", w: "5.2rem" },
];

export const SHEET_NUM_FIELDS = new Set(["K", "L", "M", "N", "O", "P", "Q", "T", "U"]);
export const SHEET_FIELD_OF: Record<string, keyof SheetSession> = {
  F: "kind", H: "title", I: "deliveryMode", J: "location", K: "lengthHours", L: "maxStudents",
  M: "facultyNeeded", N: "facultyContactPolicy", O: "supportStaffNeeded", P: "supportContactPolicy",
  Q: "week", R: "dayOfWeek", S: "notes", T: "preceptorsNeeded", U: "preceptorContactPolicy",
  V: "rotationType", W: "clinicalMode",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KINDS = ["CLASS", "LAB", "CLINICAL"];

export function SessionSheet({
  programId, courseId, courseCode, courseTitle, termNumber, semester, sessions, enrollment, assumptions,
}: {
  programId: string;
  courseId: string;
  courseCode: string | null;
  courseTitle: string;
  termNumber: number;
  semester: string;
  sessions: SheetSession[];
  enrollment: number;
  assumptions: WorkloadAssumptions;
}) {
  // Local editable copy so the formula columns recalculate as you type.
  const [rows, setRows] = useState<SheetSession[]>(sessions);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  useEffect(() => { setRows(sessions); setDirty(new Set()); }, [sessions]);

  const setField = (id: string, field: keyof SheetSession, value: unknown) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    setDirty((d) => new Set(d).add(id));
  };

  const ordered = [...rows].sort((a, b) => a.kind.localeCompare(b.kind) || a.number - b.number);

  return (
    <div className="mt-3">
      <div className="mb-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="font-semibold uppercase tracking-wide text-slate-400">Session table</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-blue-300 bg-blue-50" /> editable input</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-emerald-300 bg-emerald-50" /> live formula — hover for what drives it</span>
        <span>Edits recalculate instantly; <strong>Save row</strong> commits to the template.</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="border-collapse text-[11px]" style={{ minWidth: "220rem" }}>
          <thead>
            <tr className="bg-slate-800 text-left text-slate-100">
              {SHEET_COLS.map(({ c, w }) => (
                <th key={c} className="border-r border-slate-700 px-1.5 py-1.5 align-bottom font-medium" style={{ minWidth: w }}>
                  <span className="block font-mono text-[9px] text-emerald-300">{c}{["A", "B", "D", "E", "G"].includes(c) ? " · seq" : SHEET_FIELD_OF[c] ? "" : " · fx"}</span>
                  <span className="leading-tight">{CAPACITY_HEADERS[c as keyof typeof CAPACITY_HEADERS]}</span>
                </th>
              ))}
              <th className="px-1.5 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {ordered.map((r) => {
              const comp = computeColumns(r, enrollment, assumptions);
              const isDirty = dirty.has(r.id);
              const formId = `sess-${r.id}`;
              const calcVal: Record<string, string> = {
                C: num(comp.C, 1), X: num(comp.X), Y: comp.divByZero ? "#DIV/0!" : num(comp.Y, 0), Z: num(comp.Z),
                AA: num(comp.AA), AB: num(comp.AB), AC: num(comp.AC), AD: num(comp.AD, 3), AE: num(comp.AE),
              };
              const seqVal: Record<string, string> = {
                A: `Term ${termNumber}`, B: semester, D: courseCode ?? "—", E: courseTitle, G: String(r.number),
              };
              return (
                <tr key={r.id} className="border-b border-slate-100 align-top hover:bg-slate-50/60">
                  {SHEET_COLS.map(({ c, kind }) => {
                    if (kind === "seq" || c === "G") {
                      return <td key={c} className="border-r border-slate-100 bg-slate-50/70 px-1.5 py-1 text-slate-500" title={CAPACITY_FORMULAS[c]}>{seqVal[c]}</td>;
                    }
                    if (kind === "calc") {
                      const err = c !== "C" && comp.divByZero;
                      return (
                        <td key={c} title={CAPACITY_FORMULAS[c]} className={`border-r border-slate-100 px-1.5 py-1 text-right font-mono tabular-nums ${err ? "bg-rose-50 font-semibold text-rose-700" : "bg-emerald-50/70 text-emerald-900"}`}>
                          {calcVal[c]}
                        </td>
                      );
                    }
                    const field = SHEET_FIELD_OF[c]!;
                    const v = r[field];
                    const common = "w-full rounded border border-blue-200 bg-blue-50/70 px-1 py-0.5 text-[11px] text-blue-900 focus:bg-white focus:outline-blue-500";
                    return (
                      <td key={c} className="border-r border-slate-100 px-1 py-0.5">
                        {c === "F" ? (
                          <select value={r.kind} onChange={(e) => setField(r.id, "kind", e.target.value)} className={common}>
                            {KINDS.map((k) => <option key={k} value={k}>{k[0] + k.slice(1).toLowerCase()}</option>)}
                          </select>
                        ) : c === "R" ? (
                          <select value={(v as string | null) ?? ""} onChange={(e) => setField(r.id, "dayOfWeek", e.target.value || null)} className={common}>
                            <option value="">—</option>
                            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                        ) : SHEET_NUM_FIELDS.has(c) ? (
                          <input type="number" step="any" value={(v as number | null) ?? ""} onChange={(e) => setField(r.id, field, e.target.value === "" ? null : Number(e.target.value))} className={`${common} text-right font-mono`} />
                        ) : (
                          <input value={(v as string | null) ?? ""} onChange={(e) => setField(r.id, field, e.target.value || null)} className={common} />
                        )}
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-1.5 py-1">
                    <form id={formId} action={updateSession.bind(null, r.id, programId)}>
                      {/* Hidden mirrors of the row state so Save commits exactly what's shown */}
                      <input type="hidden" name="title" value={r.title ?? ""} readOnly />
                      <input type="hidden" name="lengthHours" value={r.lengthHours ?? 0} readOnly />
                      <input type="hidden" name="maxStudents" value={r.maxStudents ?? 1} readOnly />
                      <input type="hidden" name="facultyNeeded" value={r.facultyNeeded ?? 0} readOnly />
                      <input type="hidden" name="supportStaffNeeded" value={r.supportStaffNeeded ?? 0} readOnly />
                      <input type="hidden" name="preceptorsNeeded" value={r.preceptorsNeeded ?? 0} readOnly />
                      <input type="hidden" name="week" value={r.week ?? ""} readOnly />
                      <input type="hidden" name="dayOfWeek" value={r.dayOfWeek ?? ""} readOnly />
                      <input type="hidden" name="startTime" value={r.startTime ?? ""} readOnly />
                      <input type="hidden" name="location" value={r.location ?? ""} readOnly />
                      <input type="hidden" name="rotationType" value={r.rotationType ?? ""} readOnly />
                      <input type="hidden" name="clinicalMode" value={r.clinicalMode ?? ""} readOnly />
                      <input type="hidden" name="deliveryMode" value={r.deliveryMode ?? ""} readOnly />
                      <input type="hidden" name="notes" value={r.notes ?? ""} readOnly />
                      <input type="hidden" name="facultyContactPolicy" value={r.facultyContactPolicy ?? ""} readOnly />
                      <input type="hidden" name="supportContactPolicy" value={r.supportContactPolicy ?? ""} readOnly />
                      <input type="hidden" name="preceptorContactPolicy" value={r.preceptorContactPolicy ?? ""} readOnly />
                      <button className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isDirty ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-slate-100 text-slate-400"}`}>Save row</button>
                    </form>
                    <form action={deleteSession.bind(null, r.id, programId)} className="mt-0.5 text-center">
                      <button className="text-[10px] text-slate-300 hover:text-rose-600" title="delete session">✕</button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {ordered.length === 0 && (
              <tr><td colSpan={SHEET_COLS.length + 1} className="px-3 py-3 text-xs text-slate-400">No sessions yet — add one below.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
