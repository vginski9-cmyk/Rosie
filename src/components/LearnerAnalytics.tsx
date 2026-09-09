"use client";

// Learner analytics — aggregate and disaggregate every student by any coded
// dimension (sex, race / ethnicity, age band, county, residency, prior
// education, employment, first-generation, veteran, Pell, disability, program,
// cohort, entry year, status, withdrawal reason): counts, shares, completion
// and withdrawal rates, average age and GPA — plus a two-way cross-tab.

import { useMemo, useState } from "react";
import { DIMENSIONS, pivot, crosstab, ageOn, dimensionValue, type Dimension, type LearnerLite } from "@/lib/learners";
import { dec } from "@/lib/format";

export interface AnalyticsLearner extends LearnerLite { institutionId: string; programId: string; cohortId: string | null }

const n = (x: number) => x.toLocaleString();
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const f1 = (x: number | null) => (x == null ? "—" : dec(x));

export function LearnerAnalytics({ learners, today }: { learners: AnalyticsLearner[]; today: string }) {
  const [dim, setDim] = useState<Dimension>("raceEthnicity");
  const [colDim, setColDim] = useState<Dimension>("sex");
  const [fInst, setFInst] = useState(""); const [fProg, setFProg] = useState(""); const [fCohort, setFCohort] = useState(""); const [fYear, setFYear] = useState(""); const [fStatus, setFStatus] = useState("");
  const [slice, setSlice] = useState<{ dim: Dimension; value: string }[]>([]);

  const institutions = useMemo(() => [...new Map(learners.map((l) => [l.institutionId, l.institution])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [learners]);
  const programs = useMemo(() => [...new Map(learners.filter((l) => !fInst || l.institutionId === fInst).map((l) => [l.programId, l.program])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [learners, fInst]);
  const cohorts = useMemo(() => [...new Map(learners.filter((l) => (!fInst || l.institutionId === fInst) && (!fProg || l.programId === fProg)).filter((l) => l.cohortId).map((l) => [l.cohortId!, l.cohort!])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [learners, fInst, fProg]);
  const years = useMemo(() => [...new Set(learners.map((l) => l.entryYear).filter((y): y is number => y != null))].sort((a, b) => b - a), [learners]);

  const filtered = useMemo(() => learners.filter((l) => (!fInst || l.institutionId === fInst) && (!fProg || l.programId === fProg) && (!fCohort || l.cohortId === fCohort) && (!fYear || String(l.entryYear) === fYear) && (!fStatus || l.status === fStatus) && slice.every((s) => dimensionValue(l, s.dim, today) === s.value)), [learners, fInst, fProg, fCohort, fYear, fStatus, slice, today]);
  const rows = useMemo(() => pivot(filtered, dim, today), [filtered, dim, today]);
  const ct = useMemo(() => crosstab(filtered, dim, colDim, today), [filtered, dim, colDim, today]);
  const all = useMemo(() => pivot(filtered, "status", today), [filtered, today]);
  const ages = filtered.map((l) => ageOn(l.dob, today)).filter((a): a is number => a != null);
  const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;
  const completed = filtered.filter((l) => ["completed", "licensed", "placed", "productive"].includes(l.status)).length;
  const withdrawn = filtered.filter((l) => l.status === "withdrawn").length;
  const sel = "rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm";
  const lbl = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <label className="block"><span className={lbl}>Institution</span><select value={fInst} onChange={(e) => { setFInst(e.target.value); setFProg(""); setFCohort(""); }} className={sel}><option value="">All</option>{institutions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="block"><span className={lbl}>Program</span><select value={fProg} onChange={(e) => { setFProg(e.target.value); setFCohort(""); }} className={sel}><option value="">All</option>{programs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="block"><span className={lbl}>Cohort</span><select value={fCohort} onChange={(e) => setFCohort(e.target.value)} className={sel}><option value="">All</option>{cohorts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="block"><span className={lbl}>Entry year</span><select value={fYear} onChange={(e) => setFYear(e.target.value)} className={sel}><option value="">All</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <label className="block"><span className={lbl}>Status</span><select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={sel}><option value="">All</option>{["prospect", "applicant", "admitted", "enrolled", "completed", "licensed", "placed", "productive", "withdrawn"].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        {slice.length > 0 && <span className="flex flex-wrap items-center gap-1 text-xs">{slice.map((s) => <button key={s.dim + s.value} onClick={() => setSlice(slice.filter((x) => x !== s))} className="rounded-full bg-rose-600 px-2 py-0.5 text-white" title="remove this slice">{DIMENSIONS.find((d) => d.key === s.dim)?.label}: {s.value} ✕</button>)}</span>}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {[["Learners", n(filtered.length), `${all.map((r) => `${r.n} ${r.value}`).slice(0, 4).join(" · ")}`], ["Average age", f1(avgAge), `${ages.length} with a date of birth`], ["Completed", n(completed), pct(completed + withdrawn ? completed / (completed + withdrawn) : null) + " of decided"], ["Withdrawn", n(withdrawn), pct(completed + withdrawn ? withdrawn / (completed + withdrawn) : null) + " of decided"], ["In progress", n(filtered.filter((l) => ["enrolled"].includes(l.status)).length), "enrolled now"]].map(([k, v, s]) => (
          <div key={k} className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div><div className="text-xl font-bold tabular-nums text-slate-900">{v}</div><div className="truncate text-[11px] text-slate-500" title={s}>{s}</div></div>
        ))}
      </div>

      {/* One-way pivot */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs"><span className="text-slate-400">break down by</span>{DIMENSIONS.map((d) => <button key={d.key} onClick={() => setDim(d.key)} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${dim === d.key ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{d.label}</button>)}<span className="ml-auto text-slate-500">click a value to slice everything by it</span></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">{DIMENSIONS.find((d) => d.key === dim)?.label}</th><th className="px-2 py-1.5 text-right">Learners</th><th className="px-2 py-1.5 text-right">Share</th><th className="px-2 py-1.5 text-right">In progress</th><th className="px-2 py-1.5 text-right">Completed</th><th className="px-2 py-1.5 text-right">Withdrawn</th><th className="px-2 py-1.5 text-right">Completion rate</th><th className="px-2 py-1.5 text-right">Withdrawal rate</th><th className="px-2 py-1.5 text-right">Avg age</th><th className="px-2 py-1.5 text-right">Avg GPA</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.value} className="hover:bg-rose-50/40">
                  <td className="px-3 py-1.5"><button onClick={() => setSlice([...slice.filter((s) => s.dim !== dim), { dim, value: r.value }])} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{r.value}</button></td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n(r.n)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums"><span className="inline-block h-2 rounded bg-rose-200 align-middle" style={{ width: `${Math.max(2, r.share * 80)}px` }} /> {pct(r.share)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n(r.inProgress)}</td><td className="px-2 py-1.5 text-right tabular-nums">{n(r.completed)}</td><td className="px-2 py-1.5 text-right tabular-nums">{n(r.withdrawn)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pct(r.completionRate)}</td><td className="px-2 py-1.5 text-right tabular-nums">{pct(r.withdrawalRate)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{f1(r.avgAge)}</td><td className="px-2 py-1.5 text-right tabular-nums">{r.avgGpa == null ? "—" : dec(r.avgGpa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cross-tab */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs"><span className="text-slate-400">cross-tab {DIMENSIONS.find((d) => d.key === dim)?.label} ×</span><select value={colDim} onChange={(e) => setColDim(e.target.value as Dimension)} className="rounded border border-slate-300 px-1.5 py-0.5 text-xs">{DIMENSIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left"></th>{ct.cols.map((c) => <th key={c} className="px-2 py-1.5 text-right">{c}</th>)}<th className="px-2 py-1.5 text-right">Total</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{ct.rows.map((r) => <tr key={r.value}><td className="px-3 py-1 font-medium text-slate-800">{r.value}</td>{r.cells.map((c, i) => <td key={i} className="px-2 py-1 text-right tabular-nums">{c || <span className="text-slate-300">·</span>}</td>)}<td className="px-2 py-1 text-right tabular-nums font-medium">{r.n}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
