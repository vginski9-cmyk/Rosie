"use client";

import { useMemo, useState } from "react";
import {
  buildInstances, weeklyNeed, settingAsks, shiftBoard, sumBy, peakOf,
  type DatedInstance, type CohortCalendarInput, type WorkloadAssumptions, type SessionInput,
} from "@/lib/capacitymodel";

// The capacity workbook's three output tabs, on live data:
//   staffing — "How many instructors and preceptors do we need, and when?"  (FTEs per Week)
//   sites    — "What does each clinical site need to host, and when?"       (FTEs per Setting)
//   coverage — "How many shifts must be covered on each date?"              (# of Shifts)
// One filter bar (cohorts · terms · session type), the same dated-instance
// expansion under all three, so every number traces back to the session table.

export interface CapacityCohort {
  cohortId: string;
  cohort: string;
  status: string;
  programId: string;
  program: string;
  familyId: string | null;
  family: string | null;
  students: number;
  enrollmentByTerm: Record<number, number>;
  termStartByIndex: Record<number, string | null>;
  courses: { code: string | null; title: string; termIndex: number; termName: string; sessions: SessionInput[] }[];
  assumptions: WorkloadAssumptions;
}

export type CapacityView = "staffing" | "sites" | "coverage";

export interface ClinicalSite {
  id: string;
  name: string;
  setting: string | null;
  city: string | null;
  /** Students per day this site can host. */
  wblSlots: number | null;
  status: string;
}

const n0 = (v: number) => Math.round(v).toLocaleString();
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1 });
const fmtDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtDateM = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtMonth = (m: string) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_KEY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6, Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6 };

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`rounded-full border px-2.5 py-0.5 text-[11.5px] transition-colors ${on ? "border-rose-600 bg-rose-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-rose-300"}`}>
      {label}
    </button>
  );
}

function Peak({ k, v, d }: { k: string; v: string; d: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{k}</div>
      <div className="font-mono text-lg font-semibold tabular-nums text-slate-800">{v}</div>
      <div className="text-[11px] text-slate-500">{d}</div>
    </div>
  );
}

export function CapacityBoard({ cohorts, view, sites = [] }: { cohorts: CapacityCohort[]; view: CapacityView; sites?: ClinicalSite[] }) {
  const [cohortsOn, setCohortsOn] = useState<Set<string>>(new Set(cohorts.map((c) => c.cohortId)));
  const [termsOn, setTermsOn] = useState<Set<number> | null>(null); // null = all
  const [kindsOn, setKindsOn] = useState<Set<string>>(new Set(view === "staffing" ? ["CLASS", "LAB", "CLINICAL"] : ["CLINICAL"]));

  const allTermIdxs = useMemo(() => [...new Set(cohorts.flatMap((c) => c.courses.map((x) => x.termIndex)))].sort((a, b) => a - b), [cohorts]);

  const instances: DatedInstance[] = useMemo(() => {
    const out: DatedInstance[] = [];
    for (const c of cohorts) {
      if (!cohortsOn.has(c.cohortId)) continue;
      const input: CohortCalendarInput = {
        cohortId: c.cohortId, cohort: c.cohort, programId: c.programId, program: c.program,
        enrollmentByTerm: c.enrollmentByTerm,
        termStartByIndex: Object.fromEntries(Object.entries(c.termStartByIndex).map(([k, v]) => [k, v ? new Date(v) : null])),
        courses: c.courses,
      };
      out.push(...buildInstances(input, c.assumptions));
    }
    return out.filter((i) =>
      (termsOn == null || termsOn.has(i.termIndex)) &&
      kindsOn.has(i.session.kind) &&
      i.mondayIso != null,
    );
  }, [cohorts, cohortsOn, termsOn, kindsOn]);

  const toggle = <T,>(set: Set<T>, v: T): Set<T> => { const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); return n; };

  return (
    <div className="space-y-6">
      {/* ── Filter bar (the workbook's page filters) ─────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cohorts</div>
            <div className="flex flex-wrap gap-1.5">
              {cohorts.map((c) => (
                <Chip key={c.cohortId} on={cohortsOn.has(c.cohortId)} label={`${c.cohort} · ${c.program}`} onClick={() => setCohortsOn((s) => toggle(s, c.cohortId))} />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Term Number</div>
            <div className="flex flex-wrap gap-1.5">
              <Chip on={termsOn == null} label="Every term" onClick={() => setTermsOn(null)} />
              {allTermIdxs.map((t) => (
                <Chip key={t} on={termsOn?.has(t) ?? false} label={`Term ${t}`} onClick={() => setTermsOn((s) => (s == null ? new Set([t]) : toggle(s, t)))} />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Session Type</div>
            <div className="flex flex-wrap gap-1.5">
              {["CLASS", "LAB", "CLINICAL"].map((k) => (
                <Chip key={k} on={kindsOn.has(k)} label={k[0] + k.slice(1).toLowerCase()} onClick={() => setKindsOn((s) => toggle(s, k))} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {view === "staffing" && <StaffingView rows={instances} />}
      {view === "sites" && <SitesView rows={instances} sites={sites} />}
      {view === "coverage" && <CoverageView rows={instances} />}
    </div>
  );
}

// ───────────────────────── 03 · Instructors & preceptors ─────────────────────
function StaffingView({ rows }: { rows: DatedInstance[] }) {
  const weekly = useMemo(() => weeklyNeed(rows), [rows]);
  const peakFac = weekly.reduce((b, r) => (r.facultyFte > (b?.facultyFte ?? 0) ? r : b), null as null | (typeof weekly)[number]);
  const peakPre = weekly.reduce((b, r) => (r.preceptorFte > (b?.preceptorFte ?? 0) ? r : b), null as null | (typeof weekly)[number]);
  const active = weekly.filter((w) => w.facultyFte > 0 || w.preceptorFte > 0);
  const maxV = Math.max(1, ...weekly.map((w) => Math.max(w.facultyFte, w.preceptorFte)));

  // Staffing plan by term: peak weekly need per term.
  const byTerm = useMemo(() => {
    const idxs = [...new Set(rows.map((r) => r.termIndex))].sort((a, b) => a - b);
    return idxs.map((ti) => {
      const tr = rows.filter((r) => r.termIndex === ti);
      const w = weeklyNeed(tr);
      const pf = Math.max(0, ...w.map((x) => x.facultyFte));
      const pp = Math.max(0, ...w.map((x) => x.preceptorFte));
      const weeks = w.filter((x) => x.facultyFte > 0 || x.preceptorFte > 0);
      return {
        termIndex: ti, termName: tr[0]?.termName ?? `Term ${ti}`,
        peakFacFte: pf, peakPreFte: pp, facHeads: Math.ceil(pf - 1e-9), preHeads: Math.ceil(pp - 1e-9),
        from: weeks[0]?.mondayIso ?? null, to: weeks[weeks.length - 1]?.mondayIso ?? null,
        cohorts: [...new Set(tr.map((r) => r.cohort))],
      };
    });
  }, [rows]);

  if (!rows.length) return <p className="text-sm text-slate-400">Nothing in this slice — turn a chip back on.</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Peak k="Peak faculty need" v={peakFac && peakFac.facultyFte > 0 ? `${n1(peakFac.facultyFte)} FTE` : "—"} d={peakFac && peakFac.facultyFte > 0 ? `${peakFac.facultyHeads} people · week of ${fmtDateM(peakFac.mondayIso)}` : ""} />
        <Peak k="Peak preceptor need" v={peakPre && peakPre.preceptorFte > 0 ? `${n1(peakPre.preceptorFte)} FTE` : "—"} d={peakPre && peakPre.preceptorFte > 0 ? `${peakPre.preceptorHeads} people · week of ${fmtDateM(peakPre.mondayIso)}` : ""} />
        <Peak k="Weeks with demand" v={`${active.length}`} d={active.length ? `${fmtDateM(active[0].mondayIso)} → ${fmtDateM(active[active.length - 1].mondayIso)}` : ""} />
        <Peak k="Average active week" v={active.length ? `${n1(active.reduce((s, w) => s + w.facultyFte + w.preceptorFte, 0) / active.length)} FTE` : "—"} d="faculty + preceptor combined" />
      </div>

      {/* Week-by-week bars */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Week by week — every bar is a real week</h2>
          <div className="flex gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" /> faculty FTE</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" /> preceptor FTE</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="flex items-end gap-[3px]" style={{ height: 140, minWidth: weekly.length * 14 }}>
            {weekly.map((w) => (
              <div key={w.mondayIso} className="group relative flex h-full flex-1 items-end gap-[1px]" title={`Week of ${fmtDate(w.mondayIso)} — faculty ${n1(w.facultyFte)} FTE (${w.facultyHeads} people) · preceptors ${n1(w.preceptorFte)} FTE (${w.preceptorHeads} people) · ${n0(w.sections)} sections`}>
                <div className="w-1/2 rounded-t-sm bg-emerald-600/90" style={{ height: `${(w.facultyFte / maxV) * 100}%` }} />
                <div className="w-1/2 rounded-t-sm bg-amber-500/90" style={{ height: `${(w.preceptorFte / maxV) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>{weekly.length ? fmtDateM(weekly[0].mondayIso) : ""}</span>
            <span>{weekly.length ? fmtDateM(weekly[weekly.length - 1].mondayIso) : ""}</span>
          </div>
        </div>
      </section>

      {/* Staffing plan by term */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Staffing plan by term — who you need, in people</h2>
          <p className="text-[11px] text-slate-400">Hand this to scheduling: the peak simultaneous need for each term across the cohorts in the slice.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-semibold">Term</th>
                <th className="px-3 py-2 text-right font-semibold">Peak faculty FTE</th>
                <th className="px-3 py-2 text-right font-semibold">Faculty (people)</th>
                <th className="px-3 py-2 text-right font-semibold">Peak preceptor FTE</th>
                <th className="px-3 py-2 text-right font-semibold">Preceptors (people)</th>
                <th className="px-3 py-2 font-semibold">Window</th>
                <th className="px-3 py-2 font-semibold">Cohorts</th>
              </tr>
            </thead>
            <tbody>
              {byTerm.map((t) => (
                <tr key={t.termIndex} className="border-b border-slate-100">
                  <td className="px-3 py-1.5 font-medium text-slate-800">{t.termName}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{n1(t.peakFacFte)}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-emerald-700">{t.facHeads}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{n1(t.peakPreFte)}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-amber-700">{t.preHeads}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">{t.from ? `${fmtDateM(t.from)} → ${t.to ? fmtDateM(t.to) : ""}` : "—"}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">{t.cohorts.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pivot detail */}
      <PivotDetail rows={rows} />
    </div>
  );
}

function PivotDetail({ rows }: { rows: DatedInstance[] }) {
  const weekly = weeklyNeed(rows);
  const [open, setOpen] = useState<Set<string>>(new Set());
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">Pivot detail — week → course → sessions</h2>
        <p className="text-[11px] text-slate-400">Same hierarchy as the workbook pivot; click a week to expand what drives it.</p>
      </div>
      <div className="max-h-[28rem] overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-slate-800 text-left text-slate-100">
            <tr>
              <th className="px-3 py-2 font-medium">Week of</th>
              <th className="px-3 py-2 text-right font-medium">Sum of Total number of faculty contact hours (weekly)</th>
              <th className="px-3 py-2 text-right font-medium">Sum of Total number of preceptor contact hours (weekly)</th>
              <th className="px-3 py-2 text-right font-medium">Sections</th>
            </tr>
          </thead>
          <tbody>
            {weekly.map((w) => {
              const isOpen = open.has(w.mondayIso);
              const wkRows = rows.filter((r) => r.mondayIso === w.mondayIso);
              const byCourse = new Map<string, DatedInstance[]>();
              for (const r of wkRows) { const k = `${r.courseCode ?? r.courseTitle} · ${r.cohort}`; byCourse.set(k, [...(byCourse.get(k) ?? []), r]); }
              return [
                <tr key={w.mondayIso} onClick={() => setOpen((s) => { const n = new Set(s); n.has(w.mondayIso) ? n.delete(w.mondayIso) : n.add(w.mondayIso); return n; })} className="cursor-pointer border-b border-slate-100 bg-slate-50/70 font-medium hover:bg-rose-50/50">
                  <td className="px-3 py-1.5">{isOpen ? "▾" : "▸"} Week of {fmtDateM(w.mondayIso)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{n1(w.facultyFte)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{n1(w.preceptorFte)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{n0(w.sections)}</td>
                </tr>,
                ...(isOpen
                  ? [...byCourse.entries()].map(([k, rs]) => (
                      <tr key={w.mondayIso + k} className="border-b border-slate-50">
                        <td className="px-3 py-1 pl-9 text-slate-500">{k} <span className="text-slate-300">· {rs.length} session{rs.length === 1 ? "" : "s"}</span></td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums text-slate-500">{n1(rs.reduce((s, r) => s + (r.computed.AB ?? 0), 0))}</td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums text-slate-500">{n1(rs.reduce((s, r) => s + (r.computed.AE ?? 0), 0))}</td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums text-slate-500">{n0(rs.reduce((s, r) => s + (r.computed.Y ?? 0), 0))}</td>
                      </tr>
                    ))
                  : []),
              ];
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ───────────────────────────── 04 · Clinical sites ───────────────────────────
function SitesView({ rows, sites }: { rows: DatedInstance[]; sites: ClinicalSite[] }) {
  const clinical = rows.filter((r) => r.session.kind === "CLINICAL");
  const asks = useMemo(() => settingAsks(rows), [rows]);
  const months = useMemo(() => {
    const ms = [...new Set(clinical.map((r) => r.month).filter(Boolean))].sort() as string[];
    const settings = [...new Set(clinical.map((r) => r.session.rotationType ?? "(unspecified)"))].sort();
    return { ms, settings };
  }, [clinical]);

  if (!clinical.length) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-slate-400">No clinical demand in this slice yet — lock in an instantiation (its clinical sessions land on the calendar), or widen the filters. The supply side below fills in as you add partner sites.</p>
        <SupplyVsDemand rows={clinical} sites={sites} />
      </div>
    );
  }

  const studentDays = (setting: string, month: string) =>
    clinical.filter((r) => (r.session.rotationType ?? "(unspecified)") === setting && r.month === month)
      .reduce((s, r) => s + (r.computed.Y ?? 0), 0);

  const weeklyPre = sumBy(clinical, (i) => i.mondayIso, "preWeekly");
  const peak = peakOf(weeklyPre);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Peak k="Settings needing hosts" v={String(asks.length)} d={asks.map((a) => a.setting).join(" · ")} />
        <Peak k="Peak preceptor week" v={peak ? `${n1(peak.value)} FTE` : "—"} d={peak ? `week of ${fmtDateM(peak.key as string)}` : ""} />
        <Peak k="Total preceptor hours" v={n0(asks.reduce((s, a) => s + a.preceptorHours, 0))} d="across the slice" />
        <Peak k="Clinical shifts (sections)" v={n0(asks.reduce((s, a) => s + a.sectionsTotal, 0))} d="each is one hosted group" />
      </div>

      {/* Supply vs demand — can the sites in supply absorb this? */}
      <SupplyVsDemand rows={clinical} sites={sites} />

      {/* Site request sheet */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Site request sheet — one block per setting</h2>
          <p className="text-[11px] text-slate-400">What to ask each site for: students on their heaviest day, the days and window, and the preceptors it takes.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {asks.map((a) => (
            <div key={a.setting} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <h3 className="font-semibold text-slate-800">{a.setting}</h3>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">{n1(a.preceptorPeakWeekFte)} preceptor FTE peak week</span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div><dt className="text-slate-400">Students on peak day</dt><dd className="font-mono font-semibold text-slate-800">{n0(a.studentPeakDay)}</dd></div>
                <div><dt className="text-slate-400">Hosted shifts (sections)</dt><dd className="font-mono font-semibold text-slate-800">{n0(a.sectionsTotal)}</dd></div>
                <div><dt className="text-slate-400">Preceptor hours total</dt><dd className="font-mono font-semibold text-slate-800">{n0(a.preceptorHours)}</dd></div>
                <div><dt className="text-slate-400">Weeks of demand</dt><dd className="font-mono font-semibold text-slate-800">{a.weeks}</dd></div>
                <div className="col-span-2"><dt className="text-slate-400">Window</dt><dd className="text-slate-700">{a.firstIso ? `${fmtDateM(a.firstIso)} → ${a.lastIso ? fmtDateM(a.lastIso) : ""}` : "—"}</dd></div>
                <div className="col-span-2"><dt className="text-slate-400">Days on site</dt><dd className="text-slate-700">{a.days.length ? a.days.join(" · ") : "day not set in template"}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      </section>

      {/* Month by month, by setting */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Month by month, by setting — hosted shifts each site carries</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-semibold">Setting</th>
                {months.ms.map((m) => <th key={m} className="px-3 py-2 text-right font-semibold">{fmtMonth(m)}</th>)}
                <th className="px-3 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {months.settings.map((setting) => {
                const vals = months.ms.map((m) => studentDays(setting, m));
                return (
                  <tr key={setting} className="border-b border-slate-100">
                    <td className="px-3 py-1.5 font-medium text-slate-800">{setting}</td>
                    {vals.map((v, i) => <td key={i} className={`px-3 py-1.5 text-right font-mono tabular-nums ${v ? "text-slate-700" : "text-slate-300"}`}>{v ? n0(v) : "·"}</td>)}
                    <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">{n0(vals.reduce((s, v) => s + v, 0))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Preceptor hours week by week */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Preceptor hours, week by week</h2>
        <WeeklyBars rows={clinical} />
      </section>
    </div>
  );
}

function SupplyVsDemand({ rows, sites }: { rows: DatedInstance[]; sites: ClinicalSite[] }) {
  // Demand: students who must be ON SITE each date (capped by section capacity).
  const byDate = new Map<string, number>();
  for (const r of rows) {
    if (!r.dateIso) continue;
    const students = Math.min(r.computed.C, (r.computed.Y ?? 0) * (r.session.maxStudents ?? 0));
    byDate.set(r.dateIso, (byDate.get(r.dateIso) ?? 0) + students);
  }
  const peak = peakOf(byDate);
  const active = sites.filter((x) => x.status === "active");
  const supply = active.reduce((n, x) => n + (x.wblSlots ?? 0), 0);
  const gap = peak ? supply - peak.value : supply;
  const verdict = !peak
    ? { cls: "bg-slate-100 text-slate-500", label: "no dated clinical demand in the slice" }
    : supply === 0
      ? { cls: "bg-rose-100 text-rose-700", label: "no active supply — every clinical day is uncovered" }
      : gap >= 0
        ? { cls: "bg-emerald-100 text-emerald-700", label: `fits — ${n0(gap)} student-slots of headroom on the peak day` }
        : { cls: "bg-rose-100 text-rose-700", label: `short by ${n0(-gap)} students on the peak day — add sites or capacity` };

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Supply vs demand — can the sites in supply absorb this?</h2>
          <p className="text-[11px] text-slate-400">Demand is students on site on the heaviest day; supply is the students/day capacity of every active partner site.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${verdict.cls}`}>{verdict.label}</span>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-3">
        <Peak k="Peak-day demand" v={peak ? `${n0(peak.value)} students` : "—"} d={peak ? `on ${fmtDate(peak.key as string)}` : "no dated clinical sessions"} />
        <Peak k="Daily supply" v={`${n0(supply)} student-slots`} d={`${active.length} active site${active.length === 1 ? "" : "s"}`} />
        <Peak k="Headroom on peak day" v={peak ? `${gap >= 0 ? "+" : ""}${n0(gap)}` : "—"} d={gap >= 0 ? "capacity to spare" : "uncovered students"} />
      </div>
      {sites.length === 0 ? (
        <div className="border-t border-slate-100 px-4 py-4 text-sm text-slate-500">
          No clinical sites in supply yet.{" "}
          <a href="/employers" className="font-medium text-rose-700 hover:underline">Add partner sites</a> with the number of
          students each can host per day, and this comparison fills in.
        </div>
      ) : (
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-semibold">Site</th>
                <th className="px-4 py-2 font-semibold">Setting</th>
                <th className="px-4 py-2 font-semibold">City</th>
                <th className="px-4 py-2 text-right font-semibold">Students / day</th>
                <th className="px-4 py-2 text-right font-semibold">Share of supply</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((x) => (
                <tr key={x.id} className={`border-b border-slate-100 ${x.status !== "active" ? "text-slate-400" : ""}`}>
                  <td className="px-4 py-1.5 font-medium">{x.name}</td>
                  <td className="px-4 py-1.5">{x.setting ?? "—"}</td>
                  <td className="px-4 py-1.5">{x.city ?? "—"}</td>
                  <td className="px-4 py-1.5 text-right font-mono tabular-nums">{x.wblSlots != null ? n0(x.wblSlots) : "not set"}</td>
                  <td className="px-4 py-1.5 text-right font-mono tabular-nums">{x.status === "active" && supply > 0 && x.wblSlots ? `${Math.round((x.wblSlots / supply) * 100)}%` : "—"}</td>
                  <td className="px-4 py-1.5">{x.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function WeeklyBars({ rows }: { rows: DatedInstance[] }) {
  const byWeek = sumBy(rows, (i) => i.mondayIso, "preTotal");
  const keys = [...byWeek.keys()].filter((k): k is string => k != null).sort();
  const maxV = Math.max(1, ...byWeek.values());
  if (!keys.length) return <p className="text-xs text-slate-400">No dated preceptor demand in the slice.</p>;
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-[3px]" style={{ height: 120, minWidth: keys.length * 12 }}>
        {keys.map((k) => (
          <div key={k} className="flex-1 rounded-t-sm bg-amber-500/90" style={{ height: `${((byWeek.get(k) ?? 0) / maxV) * 100}%` }} title={`Week of ${fmtDate(k)} — ${n0(byWeek.get(k) ?? 0)} preceptor contact hours`} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>{fmtDateM(keys[0])}</span><span>{fmtDateM(keys[keys.length - 1])}</span></div>
    </div>
  );
}

// ───────────────────────────── 05 · Daily coverage ───────────────────────────
function CoverageView({ rows }: { rows: DatedInstance[] }) {
  const board = useMemo(() => shiftBoard(rows), [rows]);
  const peakDay = board.reduce((b, d) => (d.shifts > (b?.shifts ?? 0) ? d : b), null as null | (typeof board)[number]);
  const byMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of board) m.set(d.dateIso.slice(0, 7), (m.get(d.dateIso.slice(0, 7)) ?? 0) + d.shifts);
    return [...m.entries()].sort();
  }, [board]);

  // Week rows × weekday columns.
  const weeks = useMemo(() => {
    const m = new Map<string, Map<number, (typeof board)[number]>>();
    for (const d of board) {
      const dt = new Date(d.dateIso + "T00:00:00Z");
      const dow = (dt.getUTCDay() + 6) % 7; // Mon=0
      const monday = new Date(dt.getTime() - dow * 86400000).toISOString().slice(0, 10);
      const row = m.get(monday) ?? new Map();
      row.set(dow, d);
      m.set(monday, row);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [board]);

  if (!board.length) return <p className="text-sm text-slate-400">No dated sessions in this slice — days come from the template&apos;s Week __ · day columns and each offering&apos;s real term dates.</p>;

  const totalShifts = board.reduce((s, d) => s + d.shifts, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Peak k="Heaviest single day" v={peakDay ? `${n0(peakDay.shifts)} shifts` : "—"} d={peakDay ? `${fmtDate(peakDay.dateIso)} · ${n0(peakDay.preceptorsOnSite)} preceptors on site` : ""} />
        <Peak k="Total shifts to cover" v={n0(totalShifts)} d="across the slice" />
        <Peak k="Days with coverage" v={String(board.length)} d={`${fmtDateM(board[0].dateIso)} → ${fmtDateM(board[board.length - 1].dateIso)}`} />
        <Peak k="Busiest month" v={byMonth.length ? n0(Math.max(...byMonth.map(([, v]) => v))) : "—"} d={byMonth.length ? fmtMonth(byMonth.reduce((b, e) => (e[1] > b[1] ? e : b))[0]) : ""} />
      </div>

      {/* The coverage board */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Coverage board — each cell is a real date and the shifts that day</h2>
          <p className="text-[11px] text-slate-400">Hover a cell for the courses, settings and cohorts behind it.</p>
        </div>
        <div className="max-h-[30rem] overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-slate-800 text-slate-100">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Week of</th>
                {WEEKDAYS.map((d) => <th key={d} className="px-3 py-2 text-center font-medium">{d}</th>)}
                <th className="px-3 py-2 text-right font-medium">Week total</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map(([monday, days]) => {
                const weekTotal = [...days.values()].reduce((s, d) => s + d.shifts, 0);
                return (
                  <tr key={monday} className="border-b border-slate-100">
                    <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-700">{fmtDateM(monday)}</td>
                    {WEEKDAYS.map((_, i) => {
                      const d = days.get(i);
                      if (!d) return <td key={i} className="px-3 py-1.5 text-center text-slate-200">·</td>;
                      const details = [...new Set(d.details.map((x) => `${x.cohort} · ${x.courseCode ?? ""}${x.setting ? ` @ ${x.setting}` : ""} (${x.lengthHours}h)`))].join("\n");
                      const heat = d.shifts >= (peakDay?.shifts ?? 1) ? "bg-rose-600 text-white" : d.shifts >= (peakDay?.shifts ?? 1) * 0.6 ? "bg-rose-200 text-rose-900" : "bg-emerald-50 text-emerald-900";
                      return (
                        <td key={i} className="px-1.5 py-1 text-center">
                          <span title={details} className={`inline-block min-w-[2.2rem] rounded px-1.5 py-0.5 font-mono font-semibold tabular-nums ${heat}`}>{n0(d.shifts)}</span>
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-slate-700">{n0(weekTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Coverage schedule table */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Coverage schedule — every date, setting and head-count</h2>
          <p className="text-[11px] text-slate-400">The list to hand to sites: what arrives, where, when.</p>
        </div>
        <div className="max-h-[26rem] overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 text-right font-semibold">Shifts</th>
                <th className="px-3 py-2 text-right font-semibold">Preceptors on site</th>
                <th className="px-3 py-2 font-semibold">What arrives</th>
              </tr>
            </thead>
            <tbody>
              {board.map((d) => (
                <tr key={d.dateIso} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-700">{fmtDate(d.dateIso)}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">{n0(d.shifts)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{n0(d.preceptorsOnSite)}</td>
                  <td className="px-3 py-1.5 text-slate-500">{[...new Set(d.details.map((x) => `${x.cohort} · ${x.courseCode ?? ""}${x.setting ? ` @ ${x.setting}` : ""}`))].join(" / ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
