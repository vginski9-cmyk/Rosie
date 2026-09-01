"use client";

import { Fragment, useMemo, useState } from "react";
import {
  buildInstances, weeklyNeed, weeklyNeedByKind, settingAsks, shiftBoard, sumBy, peakOf,
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

/** Multi-select pivot filter: null = everything on. */
function useSetFilter() {
  return useState<Set<string> | null>(null);
}

export function CapacityBoard({ cohorts, view, sites = [] }: { cohorts: CapacityCohort[]; view: CapacityView; sites?: ClinicalSite[] }) {
  const [cohortsOn, setCohortsOn] = useState<Set<string>>(new Set(cohorts.map((c) => c.cohortId)));
  const [termsOn, setTermsOn] = useState<Set<number> | null>(null); // null = all
  const [kindsOn, setKindsOn] = useState<Set<string>>(new Set(view === "staffing" ? ["CLASS", "LAB", "CLINICAL"] : ["CLINICAL"]));
  const [coursesOn, setCoursesOn] = useSetFilter();
  const [deliveryOn, setDeliveryOn] = useSetFilter();
  const [rotationOn, setRotationOn] = useSetFilter();
  const [modeOn, setModeOn] = useSetFilter();
  const [daysOn, setDaysOn] = useSetFilter();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const allTermIdxs = useMemo(() => [...new Set(cohorts.flatMap((c) => c.courses.map((x) => x.termIndex)))].sort((a, b) => a - b), [cohorts]);

  // Cohort-scoped expansion — the workbook's page filters slice it below.
  const base: DatedInstance[] = useMemo(() => {
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
    return out.filter((i) => i.mondayIso != null);
  }, [cohorts, cohortsOn]);

  const dayKeyOf = (i: DatedInstance) => (i.session.dayOfWeek ? WEEKDAYS[DAY_KEY[i.session.dayOfWeek] ?? 0] ?? "(async)" : "(async)");
  const courseKeyOf = (i: DatedInstance) => i.courseCode ?? i.courseTitle;
  const opts = useMemo(() => ({
    courses: [...new Set(base.map(courseKeyOf))].sort(),
    deliveries: [...new Set(base.map((i) => i.session.deliveryMode ?? "(blank)"))].sort(),
    rotations: [...new Set(base.map((i) => i.session.rotationType ?? "(blank)"))].sort(),
    modes: [...new Set(base.map((i) => i.session.clinicalMode ?? "(blank)"))].sort(),
    days: [...new Set(base.map(dayKeyOf))].sort((a, b) => (DAY_KEY[a] ?? 9) - (DAY_KEY[b] ?? 9)),
  }), [base]);

  const instances: DatedInstance[] = useMemo(() => base.filter((i) => {
    if (termsOn != null && !termsOn.has(i.termIndex)) return false;
    if (!kindsOn.has(i.session.kind)) return false;
    if (coursesOn != null && !coursesOn.has(courseKeyOf(i))) return false;
    if (deliveryOn != null && !deliveryOn.has(i.session.deliveryMode ?? "(blank)")) return false;
    if (rotationOn != null && !rotationOn.has(i.session.rotationType ?? "(blank)")) return false;
    if (modeOn != null && !modeOn.has(i.session.clinicalMode ?? "(blank)")) return false;
    if (daysOn != null && !daysOn.has(dayKeyOf(i))) return false;
    const when = i.dateIso ?? i.mondayIso!;
    if (dateFrom && when < dateFrom) return false;
    if (dateTo && when > dateTo) return false;
    return true;
  }), [base, termsOn, kindsOn, coursesOn, deliveryOn, rotationOn, modeOn, daysOn, dateFrom, dateTo]);

  // When every cohort in scope shares one workload policy, show its real divisors in the math.
  const assumptions = useMemo(() => {
    const on = cohorts.filter((c) => cohortsOn.has(c.cohortId));
    if (!on.length) return null;
    const a = on[0].assumptions;
    return on.every((c) => JSON.stringify(c.assumptions) === JSON.stringify(a)) ? a : null;
  }, [cohorts, cohortsOn]);

  const toggle = <T,>(set: Set<T>, v: T): Set<T> => { const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); return n; };
  const setToggle = (cur: Set<string> | null, v: string, set: (s: Set<string> | null) => void) =>
    set(cur == null ? new Set([v]) : toggle(cur, v));

  const pivotFilter = (label: string, options: string[], cur: Set<string> | null, set: (s: Set<string> | null) => void) =>
    options.length > 1 ? (
      <div key={label}>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        <div className="flex flex-wrap gap-1.5">
          <Chip on={cur == null} label="All" onClick={() => set(null)} />
          {options.map((o) => <Chip key={o} on={cur?.has(o) ?? false} label={o} onClick={() => setToggle(cur, o, set)} />)}
        </div>
      </div>
    ) : null;

  return (
    <div className="space-y-6">
      {/* ── Filter bar — every page filter from the workbook's pivots ─────── */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {cohorts.length > 1 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cohorts</div>
              <div className="flex flex-wrap gap-1.5">
                {cohorts.map((c) => (
                  <Chip key={c.cohortId} on={cohortsOn.has(c.cohortId)} label={`${c.cohort} · ${c.program}`} onClick={() => setCohortsOn((s) => toggle(s, c.cohortId))} />
                ))}
              </div>
            </div>
          )}
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
          {pivotFilter("Course Code", opts.courses, coursesOn, setCoursesOn)}
          {pivotFilter("Session Delivery Mode", opts.deliveries, deliveryOn, setDeliveryOn)}
          {pivotFilter("Clinical Rotation Type", opts.rotations, rotationOn, setRotationOn)}
          {pivotFilter("Clinical Mode", opts.modes, modeOn, setModeOn)}
          {pivotFilter("Day", opts.days, daysOn, setDaysOn)}
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Date range</div>
            <div className="flex items-center gap-1.5 text-xs">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded border border-slate-200 bg-white px-1.5 py-0.5" />
              <span className="text-slate-400">→</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded border border-slate-200 bg-white px-1.5 py-0.5" />
              {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-slate-400 hover:text-rose-600">clear</button>}
            </div>
          </div>
        </div>
      </div>

      {view === "staffing" && <StaffingView rows={instances} assumptions={assumptions} />}
      {view === "sites" && <SitesView rows={instances} sites={sites} />}
      {view === "coverage" && <CoverageView rows={instances} />}
    </div>
  );
}

// ───────────────────────── 03 · Instructors & preceptors ─────────────────────
// The workbook's "FTEs per Week · PivotTable1" sheet, actionable: peak-need
// narrative with the conversion math, a what-to-do list with real deadlines,
// then week-by-week (people OR contact hours, split class/lab/clinical) with a
// day-by-day drill-down inside every week.
function StaffingView({ rows, assumptions }: { rows: DatedInstance[]; assumptions: WorkloadAssumptions | null }) {
  const weekly = useMemo(() => weeklyNeedByKind(rows), [rows]);
  const [measure, setMeasure] = useState<"fte" | "hours">("fte");
  const [openWeek, setOpenWeek] = useState<string | null>(null);

  // Weekly contact HOURS by kind (Z for faculty, AC for preceptors) — the raw workbook numbers.
  const hoursByWeek = useMemo(() => {
    const m = new Map<string, { c: number; l: number; cf: number; p: number }>();
    for (const r of rows) {
      if (!r.mondayIso) continue;
      const w = m.get(r.mondayIso) ?? { c: 0, l: 0, cf: 0, p: 0 };
      const z = r.computed.Z ?? 0;
      if (r.session.kind === "CLASS") w.c += z;
      else if (r.session.kind === "LAB") w.l += z;
      else w.cf += z;
      w.p += r.computed.AC ?? 0;
      m.set(r.mondayIso, w);
    }
    return m;
  }, [rows]);

  const peakFac = weekly.reduce((b, r) => (r.totalFacFte > (b?.totalFacFte ?? 0) ? r : b), null as null | (typeof weekly)[number]);
  const peakPre = weekly.reduce((b, r) => (r.preceptorFte > (b?.preceptorFte ?? 0) ? r : b), null as null | (typeof weekly)[number]);
  const active = weekly.filter((w) => w.totalFacFte > 0 || w.preceptorFte > 0);
  const avgFac = active.length ? active.reduce((s, w) => s + w.totalFacFte, 0) / active.length : 0;
  const avgPre = active.length ? active.reduce((s, w) => s + w.preceptorFte, 0) / active.length : 0;

  // Preceptors on site, day by day — for the "up to N preceptors in one day" line.
  const clinical = rows.filter((r) => r.session.kind === "CLINICAL");
  const preByDate = new Map<string, number>();
  for (const r of clinical) if (r.dateIso) preByDate.set(r.dateIso, (preByDate.get(r.dateIso) ?? 0) + (r.computed.Y ?? 0) * (r.session.preceptorsNeeded ?? 0));
  const peakPreDay = peakOf(preByDate);
  const firstClinicalIso = clinical.map((r) => r.dateIso ?? r.mondayIso!).sort()[0] ?? null;
  const signByIso = firstClinicalIso ? new Date(new Date(firstClinicalIso + "T00:00:00Z").getTime() - 42 * 86400000).toISOString().slice(0, 10) : null;

  // Day-by-day inside a week: group the week's dated rows by date.
  const weekDays = (mondayIso: string) => {
    const inWeek = rows.filter((r) => r.mondayIso === mondayIso);
    const dated = new Map<string, DatedInstance[]>();
    const undated: DatedInstance[] = [];
    for (const r of inWeek) {
      if (r.dateIso) { const l = dated.get(r.dateIso) ?? []; l.push(r); dated.set(r.dateIso, l); }
      else undated.push(r);
    }
    return { days: [...dated.entries()].sort((a, b) => a[0].localeCompare(b[0])), undated };
  };

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

  const facDiv = assumptions ? `${n0(assumptions.facContactHours)} hrs per full-time week` : "each program's full-time weekly contact hours";
  const preDiv = assumptions ? `${n0(assumptions.preContactHours)} hrs per full-time week` : "each program's full-time preceptor week";
  const facPeakHrs = peakFac ? (hoursByWeek.get(peakFac.mondayIso)?.c ?? 0) + (hoursByWeek.get(peakFac.mondayIso)?.l ?? 0) + (hoursByWeek.get(peakFac.mondayIso)?.cf ?? 0) : 0;
  const prePeakHrs = peakPre ? hoursByWeek.get(peakPre.mondayIso)?.p ?? 0 : 0;
  const maxTotal = Math.max(0.001, ...weekly.map((w) => w.totalFacFte + w.preceptorFte));

  const KIND_CELL: Record<string, string> = { c: "text-sky-700", l: "text-violet-700", cf: "text-rose-700" };

  return (
    <div className="space-y-6">
      {/* ── The answer, in words — for deans, program directors & clinical coordinators ── */}
      <section className="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50/60 to-white p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-500">For deans, program directors &amp; clinical coordinators</div>
        <p className="mt-1 text-base font-semibold text-slate-800">
          Peak need: <span className="text-rose-700">{peakFac && peakFac.totalFacFte > 0 ? `${n1(peakFac.totalFacFte)} FTE` : "0"} of instructors</span>
          {" "}and <span className="text-amber-700">{peakPre && peakPre.preceptorFte > 0 ? `${n1(peakPre.preceptorFte)} FTE` : "0"} of preceptors</span>.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          {peakFac && peakFac.totalFacFte > 0 && <>Instructor peak in the week of <strong>{fmtDateM(peakFac.mondayIso)}</strong> ({n0(facPeakHrs)} contact hrs ÷ {facDiv}). </>}
          {peakPre && peakPre.preceptorFte > 0 && <>Preceptor peak in the week of <strong>{fmtDateM(peakPre.mondayIso)}</strong> ({n0(prePeakHrs)} preceptor hrs ÷ {preDiv}). </>}
          {active.length > 0 && <>Across {fmtDateM(active[0].mondayIso)} → {fmtDateM(active[active.length - 1].mondayIso)}.</>}
        </p>
        <div className="mt-3 rounded-lg bg-white/80 p-3 ring-1 ring-rose-100">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">What to do</div>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-slate-700">
            {peakFac && peakFac.totalFacFte > 0 && (
              <li>Plan for <strong>{n1(peakFac.totalFacFte)} FTE</strong> of instructor time in the week of <strong>{fmtDateM(peakFac.mondayIso)}</strong> ({n0(facPeakHrs)} faculty contact hours; a typical active week needs {n1(avgFac)} FTE).</li>
            )}
            {peakPre && peakPre.preceptorFte > 0 && (
              <li>Secure <strong>{n1(peakPre.preceptorFte)} FTE</strong> of preceptor time for the week of <strong>{fmtDateM(peakPre.mondayIso)}</strong> ({n0(prePeakHrs)} preceptor hours{peakPreDay ? <>; that means up to <strong>{n0(peakPreDay.value)} preceptors on site in one day</strong>, {fmtDateM(peakPreDay.key as string)}</> : null}).
                {signByIso && firstClinicalIso && <> Agreements signed before <strong>{fmtDateM(signByIso)}</strong>, six weeks ahead of the first clinical day ({fmtDateM(firstClinicalIso)}).</>}</li>
            )}
            <li>Use the week-by-week table — expand any week for the day-by-day — and the staffing plan by term to assign instructors; the filters above slice every number.</li>
          </ol>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Peak k="Peak faculty need" v={peakFac && peakFac.totalFacFte > 0 ? `${n1(peakFac.totalFacFte)} FTE` : "—"} d={peakFac && peakFac.totalFacFte > 0 ? `${peakFac.facultyHeads} people · week of ${fmtDateM(peakFac.mondayIso)}` : ""} />
        <Peak k="Peak preceptor need" v={peakPre && peakPre.preceptorFte > 0 ? `${n1(peakPre.preceptorFte)} FTE` : "—"} d={peakPre && peakPre.preceptorFte > 0 ? `${peakPre.preceptorHeads} people · week of ${fmtDateM(peakPre.mondayIso)}` : ""} />
        <Peak k="Weeks with demand" v={`${active.length}`} d={active.length ? `${fmtDateM(active[0].mondayIso)} → ${fmtDateM(active[active.length - 1].mondayIso)}` : ""} />
        <Peak k="Average active week" v={active.length ? `${n1(avgFac)} + ${n1(avgPre)} FTE` : "—"} d="instructors + preceptors" />
      </div>

      {/* ── Week by week, day by day ─────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Week by week — who you need, split class / lab / clinical</h2>
            <p className="text-[11px] text-slate-400">Every row is a real calendar week. Click a week for its day-by-day breakdown.</p>
          </div>
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs">
            <button onClick={() => setMeasure("fte")} className={`px-2.5 py-1 ${measure === "fte" ? "bg-rose-600 text-white" : "bg-white text-slate-600"}`}>People needed (FTE)</button>
            <button onClick={() => setMeasure("hours")} className={`px-2.5 py-1 ${measure === "hours" ? "bg-rose-600 text-white" : "bg-white text-slate-600"}`}>Contact hours (workbook)</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-semibold">Week of</th>
                <th className="px-3 py-2 text-right font-semibold text-sky-700">Class</th>
                <th className="px-3 py-2 text-right font-semibold text-violet-700">Lab</th>
                <th className="px-3 py-2 text-right font-semibold text-rose-700">Clinical (fac)</th>
                <th className="px-3 py-2 text-right font-semibold">Instructors{measure === "fte" ? " (FTE → people)" : " (hrs)"}</th>
                <th className="px-3 py-2 text-right font-semibold text-amber-700">Preceptors{measure === "fte" ? " (FTE → people)" : " (hrs)"}</th>
                <th className="w-1/4 px-3 py-2 font-semibold">Load</th>
              </tr>
            </thead>
            <tbody>
              {weekly.map((w) => {
                const h = hoursByWeek.get(w.mondayIso) ?? { c: 0, l: 0, cf: 0, p: 0 };
                const vals = measure === "fte"
                  ? { c: w.classFte, l: w.labFte, cf: w.clinicalFacFte, fac: w.totalFacFte, p: w.preceptorFte }
                  : { c: h.c, l: h.l, cf: h.cf, fac: h.c + h.l + h.cf, p: h.p };
                const open = openWeek === w.mondayIso;
                const dd = open ? weekDays(w.mondayIso) : null;
                return (
                  <Fragment key={w.mondayIso}>
                    <tr onClick={() => setOpenWeek(open ? null : w.mondayIso)} className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${open ? "bg-slate-50" : ""}`}>
                      <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-700">{open ? "▾" : "▸"} {fmtDateM(w.mondayIso)}</td>
                      {(["c", "l", "cf"] as const).map((k) => (
                        <td key={k} className={`px-3 py-1.5 text-right font-mono tabular-nums ${vals[k] ? KIND_CELL[k] : "text-slate-300"}`}>{vals[k] ? n1(vals[k]) : "·"}</td>
                      ))}
                      <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-slate-800">
                        {measure === "fte" ? <>{n1(vals.fac)} <span className="font-normal text-emerald-700">→ {Math.ceil(vals.fac - 1e-9)}</span></> : n0(vals.fac)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-amber-700">
                        {measure === "fte" ? <>{n1(vals.p)} <span className="font-normal">→ {Math.ceil(vals.p - 1e-9)}</span></> : n0(vals.p)}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex h-3 w-full overflow-hidden rounded-sm bg-slate-100" title={`class ${n1(w.classFte)} · lab ${n1(w.labFte)} · clinical fac ${n1(w.clinicalFacFte)} · preceptors ${n1(w.preceptorFte)} FTE`}>
                          <div className="bg-sky-500" style={{ width: `${(w.classFte / maxTotal) * 100}%` }} />
                          <div className="bg-violet-500" style={{ width: `${(w.labFte / maxTotal) * 100}%` }} />
                          <div className="bg-rose-500" style={{ width: `${(w.clinicalFacFte / maxTotal) * 100}%` }} />
                          <div className="bg-amber-400" style={{ width: `${(w.preceptorFte / maxTotal) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                    {open && dd && (
                      <tr className="border-b border-slate-200 bg-slate-50/60">
                        <td colSpan={7} className="px-4 py-3">
                          {dd.days.length === 0 && dd.undated.length === 0 && <p className="text-[11px] text-slate-400">Nothing dated in this week.</p>}
                          <div className="space-y-2">
                            {dd.days.map(([dateIso, list]) => {
                              const groups = list.filter((r) => r.session.kind !== "CLINICAL").reduce((s, r) => s + (r.computed.Y ?? 0), 0);
                              const pre = list.filter((r) => r.session.kind === "CLINICAL").reduce((s, r) => s + (r.computed.Y ?? 0) * (r.session.preceptorsNeeded ?? 0), 0);
                              const facH = list.reduce((s, r) => s + (r.computed.Z ?? 0), 0);
                              const preH = list.reduce((s, r) => s + (r.computed.AC ?? 0), 0);
                              return (
                                <div key={dateIso}>
                                  <div className="mb-1 text-[11px] font-semibold text-slate-700">
                                    {fmtDate(dateIso)} — needs <span className="text-emerald-700">{n0(groups)} instructor-led group{groups === 1 ? "" : "s"}</span>
                                    {pre > 0 && <> + <span className="text-amber-700">{n0(pre)} preceptor{pre === 1 ? "" : "s"} on site</span></>}
                                    <span className="ml-2 font-normal text-slate-400">{n0(facH)} fac hrs{preH > 0 ? ` · ${n0(preH)} preceptor hrs` : ""}</span>
                                  </div>
                                  <div className="space-y-1">
                                    {list.sort((a, b) => (a.session.startTime ?? "99").localeCompare(b.session.startTime ?? "99")).map((r, i) => (
                                      <div key={i} className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-r px-2.5 py-1 text-[11px] ${r.session.kind === "CLASS" ? "border-l-4 border-sky-500 bg-sky-50 text-sky-900" : r.session.kind === "LAB" ? "border-l-4 border-violet-500 bg-violet-50 text-violet-900" : "border-l-4 border-rose-500 bg-rose-50 text-rose-900"}`}>
                                        <span className="font-semibold">{r.session.startTime ? `${r.session.startTime} · ` : ""}{r.courseCode ?? r.courseTitle}</span>
                                        {r.session.title && <span>“{r.session.title}”</span>}
                                        <span className="tabular-nums">{n0(Math.min(r.computed.C, (r.computed.Y ?? 0) * (r.session.maxStudents ?? 0)))} students in {n0(r.computed.Y ?? 0)} group{(r.computed.Y ?? 0) === 1 ? "" : "s"} · {r.session.lengthHours}h</span>
                                        {r.session.kind === "CLINICAL"
                                          ? <span className="font-medium">{n0((r.computed.Y ?? 0) * (r.session.preceptorsNeeded ?? 0))} preceptors{r.session.rotationType ? ` @ ${r.session.rotationType}` : ""}</span>
                                          : <span className="font-medium">{n0(r.computed.Y ?? 0)} instructor{(r.computed.Y ?? 0) === 1 ? "" : "s"}</span>}
                                        <span className="ml-auto opacity-70">{r.cohort}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                            {dd.undated.length > 0 && (
                              <p className="text-[11px] text-slate-400">
                                + {dd.undated.length} session{dd.undated.length === 1 ? "" : "s"} without a set day (async / day not set in the sheet) — counted in the week totals above.
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
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

    </div>
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
  const onSite = (r: DatedInstance) => Math.min(r.computed.C, (r.computed.Y ?? 0) * (r.session.maxStudents ?? 0));
  const byDate = new Map<string, number>();
  for (const r of rows) {
    if (!r.dateIso) continue;
    byDate.set(r.dateIso, (byDate.get(r.dateIso) ?? 0) + onSite(r));
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

  // Per-setting: match demand (rotation type) against the sites declaring that
  // setting, day by day over the whole period — peak, % used, and how many
  // student-days have no slot.
  const settings = [...new Set(rows.filter((r) => r.dateIso).map((r) => r.session.rotationType ?? "(unspecified)"))].sort();
  const settingRows = settings.map((setting) => {
    const rs = rows.filter((r) => r.dateIso && (r.session.rotationType ?? "(unspecified)") === setting);
    const dByDate = new Map<string, number>();
    for (const r of rs) dByDate.set(r.dateIso!, (dByDate.get(r.dateIso!) ?? 0) + onSite(r));
    const sSites = active.filter((x) => x.setting && setting !== "(unspecified)" && x.setting.toLowerCase() === setting.toLowerCase());
    const sSupply = sSites.reduce((n, x) => n + (x.wblSlots ?? 0), 0);
    const p = peakOf(dByDate);
    let hosted = 0, total = 0, shortDays = 0;
    for (const v of dByDate.values()) { total += v; hosted += Math.min(v, sSupply); if (v > sSupply) shortDays++; }
    return {
      setting, peak: p, supply: sSupply, siteCount: sSites.length,
      hosted, total, unhosted: total - hosted, shortDays, dates: dByDate.size,
      pctUsed: sSupply > 0 && p ? Math.round((p.value / sSupply) * 100) : null,
    };
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Supply vs demand — can the sites in supply absorb this?</h2>
          <p className="text-[11px] text-slate-400">Demand is students on site on the heaviest day; supply is the students/day capacity of every active partner site. The two are matched day by day, setting by setting.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${verdict.cls}`}>{verdict.label}</span>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-3">
        <Peak k="Peak-day demand" v={peak ? `${n0(peak.value)} students` : "—"} d={peak ? `on ${fmtDate(peak.key as string)}` : "no dated clinical sessions"} />
        <Peak k="Daily supply" v={`${n0(supply)} student-slots`} d={`${active.length} active site${active.length === 1 ? "" : "s"}`} />
        <Peak k="Headroom on peak day" v={peak ? `${gap >= 0 ? "+" : ""}${n0(gap)}` : "—"} d={gap >= 0 ? "capacity to spare" : "uncovered students"} />
      </div>
      {settingRows.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Setting by setting, over the whole period</div>
          <div className="space-y-2">
            {settingRows.map((s) => {
              const noSupply = s.supply === 0;
              const pct = s.total > 0 ? Math.round((s.hosted / s.total) * 100) : 100;
              return (
                <div key={s.setting} className={`rounded-lg border p-2.5 text-xs ${noSupply || s.unhosted > 0 ? "border-rose-200 bg-rose-50/40" : "border-emerald-200 bg-emerald-50/40"}`}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-semibold text-slate-800">{s.setting}</span>
                    {noSupply ? (
                      <span className="font-medium text-rose-700">{s.peak ? `${n0(s.peak.value)} students/day at peak` : "demand"} — no supply data for this setting</span>
                    ) : (
                      <span className={s.pctUsed != null && s.pctUsed > 100 ? "font-medium text-rose-700" : "text-slate-600"}>
                        needs {s.peak ? n0(s.peak.value) : 0} slots/day at peak, sites offer {n0(s.supply)}{s.pctUsed != null ? ` (${s.pctUsed}% used)` : ""} · {s.siteCount} matching site{s.siteCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {s.peak && <>Peak day {fmtDateM(s.peak.key as string)}{!noSupply && s.peak.value > s.supply ? ` — short by ${n0(s.peak.value - s.supply)} slots` : ""}. </>}
                    Over the period: {n0(s.hosted)} of {n0(s.total)} student-days hosted ({pct}%){s.unhosted > 0 ? <strong className="text-rose-700"> — {n0(s.unhosted)} student-days have no slot across {n0(s.shortDays)} short day{s.shortDays === 1 ? "" : "s"}</strong> : ""} · {n0(s.dates)} clinical dates.
                    {noSupply && <> Add partner sites with setting “{s.setting}” (and students/day) in the Employers directory, or map this rotation to an existing setting.</>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
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
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const selected = selectedDay ? board.find((d) => d.dateIso === selectedDay) ?? null : null;
  const byDate = useMemo(() => new Map(board.map((d) => [d.dateIso, d])), [board]);

  // Month navigation — start on the first month with anything scheduled.
  const months = useMemo(() => [...new Set(board.map((d) => d.dateIso.slice(0, 7)))].sort(), [board]);
  const [month, setMonth] = useState<string | null>(null);
  const cur = month ?? months[0] ?? null;
  const monthIdx = cur ? months.indexOf(cur) : -1;
  const shiftMonth = (dir: number) => {
    if (!cur) return;
    const d = new Date(cur + "-01T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + dir);
    setMonth(d.toISOString().slice(0, 7));
  };

  if (!board.length) return <p className="text-sm text-slate-400">No dated sessions in this slice — days come from the template&apos;s Week __ · day columns and each offering&apos;s real term dates.</p>;

  // Build the month grid (Mon-first) for the current month.
  const first = new Date(cur + "-01T00:00:00Z");
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Mon=0
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${cur}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const todayIso = new Date().toISOString().slice(0, 10);

  const KIND_COLOR: Record<string, string> = {
    CLASS: "border-l-4 border-sky-500 bg-sky-50 text-sky-900",
    LAB: "border-l-4 border-violet-500 bg-violet-50 text-violet-900",
    CLINICAL: "border-l-4 border-rose-500 bg-rose-50 text-rose-900",
  };
  const fmtT = (t: string | null) => {
    if (!t) return "";
    const [h, m] = t.split(":").map(Number);
    const ap = h >= 12 ? "p" : "a"; const hh = h % 12 || 12;
    return m ? `${hh}:${String(m).padStart(2, "0")}${ap} ` : `${hh}${ap} `;
  };
  const monthLabel = cur ? new Date(cur + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "";
  const monthTotal = board.filter((d) => d.dateIso.startsWith(cur ?? "")).reduce((n, d) => n + d.shifts, 0);

  return (
    <div className="space-y-4">
      {/* ── The calendar: exact dates, times, locations — color-coded by kind ── */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <button onClick={() => shiftMonth(-1)} className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-50">←</button>
            <h2 className="min-w-[12rem] text-center text-base font-semibold text-slate-800">{monthLabel}</h2>
            <button onClick={() => shiftMonth(1)} className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-50">→</button>
            {monthIdx !== 0 && months[0] && <button onClick={() => setMonth(months[0])} className="ml-1 text-xs text-slate-400 hover:text-rose-600">jump to first scheduled month</button>}
          </div>
          <div className="flex items-center gap-4 text-[11px] text-slate-600">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" /> Class</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-500" /> Lab</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" /> Clinical</span>
            <span className="tabular-nums text-slate-400">{n0(monthTotal)} sessions this month</span>
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {WEEKDAYS.map((d) => <div key={d} className="py-1.5">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((dateIso, i) => {
            if (!dateIso) return <div key={i} className="min-h-[92px] border-b border-r border-slate-100 bg-slate-50/40" />;
            const day = byDate.get(dateIso) ?? null;
            const dayNum = Number(dateIso.slice(8, 10));
            const isToday = dateIso === todayIso;
            const isSel = selectedDay === dateIso;
            return (
              <button
                key={i}
                onClick={() => day && setSelectedDay(isSel ? null : dateIso)}
                className={`min-h-[92px] border-b border-r border-slate-100 p-1 text-left align-top ${day ? "cursor-pointer hover:bg-slate-50" : "cursor-default"} ${isSel ? "ring-2 ring-inset ring-slate-800" : ""}`}
              >
                <div className="mb-0.5 flex items-center justify-between px-0.5">
                  <span className={`text-[11px] font-semibold ${isToday ? "rounded-full bg-rose-600 px-1.5 text-white" : "text-slate-500"}`}>{dayNum}</span>
                  {day?.holiday && <span className="truncate text-[8px] font-semibold text-rose-600" title={day.holiday}>⚠ {day.holiday}</span>}
                </div>
                <div className="space-y-0.5">
                  {(day?.details ?? []).slice(0, 3).map((x, j) => (
                    <div key={j} className={`truncate rounded-r px-1 py-0.5 text-[9.5px] leading-tight ${KIND_COLOR[x.kind] ?? "bg-slate-50"}`}
                      title={`${x.courseCode ?? x.courseTitle}${x.sessionTitle ? ` — ${x.sessionTitle}` : ""} · ${n0(x.students)} students · ${x.lengthHours}h${x.startTime ? ` from ${x.startTime}` : ""}${x.setting ? ` @ ${x.setting}` : ""} · ${x.cohort}`}>
                      <span className="font-semibold">{fmtT(x.startTime)}{x.courseCode ?? x.courseTitle}</span>
                      <span className="block truncate opacity-80">{n0(x.students)} stu{x.setting ? ` @ ${x.setting}` : ""}</span>
                    </div>
                  ))}
                  {day && day.details.length > 3 && <div className="px-1 text-[9px] text-slate-400">+{day.details.length - 3} more — click</div>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Day drill-down: exactly what happens, plus the staffing it takes */}
        {selected && (
          <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-3">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">
                {fmtDate(selected.dateIso)} — {n0(selected.studentsOnSite)} students · {n0(selected.shifts)} session-group{selected.shifts === 1 ? "" : "s"} · needs {n0(selected.details.filter((x) => x.kind !== "CLINICAL").reduce((n, x) => n + x.sections, 0))} instructor-led group{selected.details.filter((x) => x.kind !== "CLINICAL").reduce((n, x) => n + x.sections, 0) === 1 ? "" : "s"} + {n0(selected.preceptorsOnSite)} preceptor{selected.preceptorsOnSite === 1 ? "" : "s"} on site
                {selected.holiday && <span className="ml-2 rounded-full bg-rose-200 px-2 py-0.5 text-[10px] font-semibold text-rose-800">⚠ {selected.holiday} — consider moving these</span>}
              </h3>
              <button onClick={() => setSelectedDay(null)} className="text-xs text-slate-400 hover:text-slate-600">close ✕</button>
            </div>
            <div className="space-y-1.5">
              {selected.details.map((x, i) => (
                <div key={i} className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-r-lg px-3 py-1.5 text-xs ${KIND_COLOR[x.kind] ?? "bg-white"}`}>
                  <span className="font-semibold">{x.startTime ? `${x.startTime} · ` : ""}{x.courseCode ? `${x.courseCode} · ` : ""}{x.courseTitle}</span>
                  {x.sessionTitle && <span>“{x.sessionTitle}”</span>}
                  <span className="tabular-nums">{n0(x.students)} students in {n0(x.sections)} group{x.sections === 1 ? "" : "s"} · {x.lengthHours}h</span>
                  {x.setting && <span className="font-medium">@ {x.setting}</span>}
                  <span className="ml-auto opacity-70">{x.cohort} · {x.program}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Coverage schedule table stays — the printable list per date */}
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
                <th className="px-3 py-2 text-right font-semibold">Students</th>
                <th className="px-3 py-2 text-right font-semibold">Groups</th>
                <th className="px-3 py-2 text-right font-semibold">Preceptors on site</th>
                <th className="px-3 py-2 font-semibold">What arrives</th>
              </tr>
            </thead>
            <tbody>
              {board.map((d) => (
                <tr key={d.dateIso} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-700">{fmtDate(d.dateIso)}{d.holiday ? <span className="ml-1 text-[10px] font-semibold text-rose-600">⚠ {d.holiday}</span> : null}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">{n0(d.studentsOnSite)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{n0(d.shifts)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{n0(d.preceptorsOnSite)}</td>
                  <td className="px-3 py-1.5 text-slate-500">{[...new Set(d.details.map((x) => `${x.startTime ? x.startTime + " " : ""}${x.courseCode ?? x.courseTitle}: ${x.students} stu (${x.kind.toLowerCase()})${x.setting ? ` @ ${x.setting}` : ""} · ${x.cohort}`))].join(" / ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
