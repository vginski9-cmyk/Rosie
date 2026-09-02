"use client";

import { useMemo, useState } from "react";
import {
  buildInstances, weeklyNeed, weeklyNeedByKind, settingAsks, shiftBoard, sumBy, peakOf,
  type DatedInstance, type CohortCalendarInput, type WorkloadAssumptions, type SessionInput,
} from "@/lib/capacitymodel";
import { ColumnChart, FAC_COLOR, PRE_COLOR, KIND_COLORS, type ColBand } from "@/components/FteCharts";
import { CoverageCalendar, type CalRoom, type CalPerson } from "@/components/CoverageCalendar";

// The capacity workbook's three output tabs, on live data:
//   staffing — "How many instructors and preceptors do we need, and when?"  (FTEs per Week)
//   sites    — "What does each clinical site need to host, and when?"       (FTEs per Setting)
//   coverage — "How many shifts must be covered on each date?"              (# of Shifts)
// One filter bar (cohorts · terms · session type), the same dated-instance
// expansion under all three, so every number traces back to the session table.

/** One booked section — a draggable shift instance on the calendar. */
export interface ShiftMeeting {
  id: string; courseId: string; kind: string; sectionIndex: number; sectionCount: number; seats: number;
  dayOfWeek: string; startTime: string;
  facilityId: string | null; employerId: string | null; unitId?: string | null; staffPersonId: string | null;
  loc: string | null; staffName: string | null;
  lengthHours?: number; termIndex?: number;
  /** One-off moves: the occurrence patterned on fromDate happens on toDate instead. */
  moves?: ShiftMoveInfo[];
}
export interface ShiftMoveInfo {
  fromDate: string; toDate: string; startTime: string | null;
  facilityId: string | null; employerId: string | null; staffPersonId: string | null;
  loc: string | null; staffName: string | null;
}

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
  meetings?: ShiftMeeting[];
  courses: { code: string | null; title: string; courseId?: string | null; termIndex: number; termName: string; sessions: SessionInput[] }[];
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
const nz2 = (v: number | null | undefined) => v ?? 0;
const fmtDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtDateM = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtMonth = (m: string) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const fmtDay = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" });
const fmtMD = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const fmtT2 = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "p" : "a"; const hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`;
};

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

export function CapacityBoard({ cohorts, view, sites = [], rooms = [], people = [], collapsible = false }: { cohorts: CapacityCohort[]; view: CapacityView; sites?: ClinicalSite[]; rooms?: CalRoom[]; people?: CalPerson[]; collapsible?: boolean }) {
  const [cohortsOn, setCohortsOn] = useState<Set<string>>(new Set(cohorts.map((c) => c.cohortId)));
  const [termsOn, setTermsOn] = useState<Set<number> | null>(null); // null = all
  // The sites view starts clinical-only (that's its subject); staffing and the
  // calendar show everything — chips narrow from there.
  const [kindsOn, setKindsOn] = useState<Set<string>>(new Set(view === "sites" ? ["CLINICAL"] : ["CLASS", "LAB", "CLINICAL"]));
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

  // Collapsible mode (per-offering embed): two headline buttons — Instructors
  // and Preceptors — with the peak numbers; clicking either drops down the
  // full week-by-week / day-by-day breakdown.
  const [expanded, setExpanded] = useState(!collapsible);
  const summary = useMemo(() => {
    const w = weeklyNeedByKind(instances);
    const pf = w.reduce((b, r) => Math.max(b, r.totalFacFte), 0);
    const pp = w.reduce((b, r) => Math.max(b, r.preceptorFte), 0);
    return { peakFac: pf, peakPre: pp, facHeads: Math.ceil(pf - 1e-9), preHeads: Math.ceil(pp - 1e-9) };
  }, [instances]);

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

  if (collapsible && view === "staffing" && !expanded) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <button onClick={() => setExpanded(true)} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/80">
          <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Instructors</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">{summary.facHeads} <span className="text-base font-normal text-slate-500">people at peak</span></div>
          <div className="mt-1 text-[11px] text-slate-500">{n1(summary.peakFac)} FTE at the heaviest week · <span className="font-medium text-emerald-700">click for every shift, day by day ▾</span></div>
        </button>
        <button onClick={() => setExpanded(true)} className="rounded-xl border border-amber-200 bg-amber-50/40 p-5 text-left transition-colors hover:border-amber-300 hover:bg-amber-50/80">
          <div className="text-[11px] font-medium uppercase tracking-wide text-amber-700">Preceptors</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">{summary.preHeads} <span className="text-base font-normal text-slate-500">people at peak</span></div>
          <div className="mt-1 text-[11px] text-slate-500">{n1(summary.peakPre)} FTE at the heaviest week · <span className="font-medium text-amber-700">click for every shift, day by day ▾</span></div>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {collapsible && view === "staffing" && (
        <button onClick={() => setExpanded(false)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-2.5 text-left text-sm hover:bg-slate-100">
          <span className="font-medium text-slate-700">
            <span className="text-emerald-700">{summary.facHeads} instructors</span> ({n1(summary.peakFac)} FTE) · <span className="text-amber-700">{summary.preHeads} preceptors</span> ({n1(summary.peakPre)} FTE) at the peak week
          </span>
          <span className="text-xs text-slate-400">collapse ▴</span>
        </button>
      )}
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
      {view === "coverage" && <CoverageView rows={instances} cohorts={cohorts} rooms={rooms} people={people} sites={sites} />}
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
  const weeklyByIso = useMemo(() => new Map(weekly.map((w) => [w.mondayIso, w])), [weekly]);
  const [closedTerms, setClosedTerms] = useState<Set<number>>(new Set());
  // Same three altitudes as the calendar: semester (budget), week (shape of
  // the load), day (every shift and who staffs it).
  const [altitude, setAltitude] = useState<"semester" | "week" | "day">("semester");

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

  // Term -> week -> day -> instance, for the shift chart. Every session
  // instance is one horizontal bar: its shifts, their length, and who staffs
  // them — day by day, week by week, term by term.
  const termGroups = useMemo(() => {
    const idxs = [...new Set(rows.map((r) => r.termIndex))].sort((a, b) => a - b);
    return idxs.map((ti) => {
      const tr = rows.filter((r) => r.termIndex === ti);
      const weekIsos = [...new Set(tr.map((r) => r.mondayIso!))].sort();
      const weeks = weekIsos.map((w) => {
        const wr = tr.filter((r) => r.mondayIso === w);
        const dateIsos = [...new Set(wr.filter((r) => r.dateIso).map((r) => r.dateIso!))].sort();
        return {
          mondayIso: w,
          days: dateIsos.map((d) => ({
            dateIso: d,
            list: wr.filter((r) => r.dateIso === d).sort((a, b) => (a.session.startTime ?? "99").localeCompare(b.session.startTime ?? "99")),
          })),
          undated: wr.filter((r) => !r.dateIso),
        };
      });
      const facHrs = tr.reduce((n, r) => n + nz2(r.computed.Z), 0);
      const preHrs = tr.reduce((n, r) => n + nz2(r.computed.AC), 0);
      const w = weeklyNeed(tr);
      return {
        ti, termName: tr[0]?.termName ?? `Term ${ti}`, weeks, facHrs, preHrs,
        peakFacFte: Math.max(0, ...w.map((x) => x.facultyFte)),
        peakPreFte: Math.max(0, ...w.map((x) => x.preceptorFte)),
      };
    });
  }, [rows]);
  const maxLen = Math.max(1, ...rows.map((r) => r.session.lengthHours ?? 0));

  // ── The workbook's pivot charts, vertical, every cap labeled ──────────────
  const SEM_ORDER: Record<string, number> = { Spring: 0, Summer: 1, Fall: 2 };
  const KIND_ORDER = ["CLASS", "LAB", "CLINICAL"];
  const KIND_NAME: Record<string, string> = { CLASS: "Class", LAB: "Lab", CLINICAL: "Clinical" };

  /** Faculty & preceptor FTEs (semesterly): Year → Semester → Session Type. */
  const semBands: ColBand[] = useMemo(() => {
    const acc = new Map<string, Map<string, Map<string, [number, number]>>>();
    for (const r of rows) {
      const year = r.mondayIso!.slice(0, 4);
      const y = acc.get(year) ?? new Map(); acc.set(year, y);
      const s = y.get(r.semester) ?? new Map(); y.set(r.semester, s);
      const k = s.get(r.session.kind) ?? [0, 0];
      k[0] += nz2(r.computed.AA); k[1] += nz2(r.computed.AD);
      s.set(r.session.kind, k);
    }
    const spanOf = (year: string, sem: string) => {
      const ws = rows.filter((r) => r.mondayIso!.slice(0, 4) === year && r.semester === sem).map((r) => r.mondayIso!).sort();
      return ws.length ? `${fmtMD(ws[0])} → ${fmtMD(ws[ws.length - 1])}` : undefined;
    };
    return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([year, sems]) => ({
      label: year,
      groups: [...sems.entries()].sort((a, b) => (SEM_ORDER[a[0]] ?? 9) - (SEM_ORDER[b[0]] ?? 9)).map(([sem, kinds]) => ({
        label: sem, sub: spanOf(year, sem),
        leaves: KIND_ORDER.filter((k) => kinds.has(k)).map((k) => ({
          label: KIND_NAME[k], title: `${sem} ${year} (${spanOf(year, sem) ?? ""}) · ${KIND_NAME[k]}`, values: kinds.get(k)!,
        })),
      })),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  /** Faculty & preceptor FTEs (weekly): Year → Semester → real calendar week. */
  const weekBands: ColBand[] = useMemo(() => {
    const acc = new Map<string, Map<string, Map<string, [number, number]>>>();
    for (const r of rows) {
      const year = r.mondayIso!.slice(0, 4);
      const y = acc.get(year) ?? new Map(); acc.set(year, y);
      const s = y.get(r.semester) ?? new Map(); y.set(r.semester, s);
      const k = s.get(r.mondayIso!) ?? [0, 0];
      k[0] += nz2(r.computed.AB); k[1] += nz2(r.computed.AE);
      s.set(r.mondayIso!, k);
    }
    return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([year, sems]) => ({
      label: year,
      groups: [...sems.entries()].sort((a, b) => (SEM_ORDER[a[0]] ?? 9) - (SEM_ORDER[b[0]] ?? 9)).map(([sem, wks]) => ({
        label: sem,
        leaves: [...wks.keys()].sort().map((w) => ({
          label: fmtMD(w), title: `${sem} ${year} · week of ${fmtDateM(w)}`, values: wks.get(w)!,
        })),
      })),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  /** Clinical staffing by rotation type — real dates over years, semesters and
   *  terms: each band is a semester, each group a real calendar week, each
   *  column a rotation setting with the days & times its shifts run. */
  const rotBands: ColBand[] = useMemo(() => {
    const clin = rows.filter((r) => r.session.kind === "CLINICAL");
    // band key `${year} ${sem}` → week mondayIso → rotation → [facFTE, preFTE, days/times]
    const acc = new Map<string, Map<string, Map<string, { v: [number, number]; when: Set<string> }>>>();
    for (const r of clin) {
      const bandKey = `${r.semester} ${r.mondayIso!.slice(0, 4)}`;
      const b = acc.get(bandKey) ?? new Map(); acc.set(bandKey, b);
      const w = b.get(r.mondayIso!) ?? new Map(); b.set(r.mondayIso!, w);
      const rot = r.session.rotationType ?? "(unspecified)";
      const cell = w.get(rot) ?? { v: [0, 0] as [number, number], when: new Set<string>() };
      cell.v[0] += nz2(r.computed.AB); cell.v[1] += nz2(r.computed.AE);
      if (r.session.dayOfWeek) cell.when.add(`${r.session.dayOfWeek}${r.session.startTime ? ` ${fmtT2(r.session.startTime)}` : ""}`);
      w.set(rot, cell);
    }
    if (!acc.size) return [];
    const bandStart = (b: Map<string, unknown>) => [...b.keys()].sort()[0] ?? "";
    return [...acc.entries()].sort((a, b) => bandStart(a[1]).localeCompare(bandStart(b[1]))).map(([bandKey, weeks]) => ({
      label: bandKey,
      groups: [...weeks.keys()].sort().map((w) => ({
        label: `wk of ${fmtMD(w)}`,
        leaves: [...weeks.get(w)!.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([rot, cell]) => ({
          label: `${rot}${cell.when.size ? ` — ${[...cell.when].sort().join(" · ")}` : ""}`,
          title: `Week of ${fmtDateM(w)} · ${rot}${cell.when.size ? ` (${[...cell.when].sort().join(", ")})` : ""}`,
          values: cell.v,
        })),
      })),
    }));
  }, [rows]);

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
      {/* ── Altitude switcher: semester · week · day ─────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm">
          {(["semester", "week", "day"] as const).map((v) => (
            <button key={v} onClick={() => setAltitude(v)} className={`px-3 py-1.5 capitalize ${altitude === v ? "bg-rose-600 font-medium text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{v}</button>
          ))}
        </div>
        <span className="text-xs text-slate-400">
          {altitude === "semester" ? "the budgeting view — FTEs per semester and the staffing plan by term"
            : altitude === "week" ? "the scheduling view — FTEs per real calendar week and clinical staffing by rotation"
            : "the ground view — every shift, day by day, and who staffs it"}
        </span>
      </div>

      {altitude === "semester" && (<>
      <TermOrders rows={rows} />
      {/* ── FTEs per semester — what to budget, split class / lab / clinical ── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2">
          <h2 className="text-sm font-semibold text-slate-700">Faculty &amp; preceptor FTEs per semester</h2>
          <p className="text-[11px] text-slate-400">The budgeting view: semesterly FTE (contact hours ÷ a full-timer&apos;s semester) by year, semester and session type. Tall clinical bars = where preceptor agreements and clinical faculty lines must be funded.</p>
        </div>
        <ColumnChart bands={semBands} series={[{ name: "Faculty FTEs", color: FAC_COLOR }, { name: "Preceptor FTEs", color: PRE_COLOR }]} unit="semesterly" leafMinWidth={46} />
      </section>

      </>)}

      {altitude === "week" && (<>
      <WeekOrders rows={rows} />
      {/* ── FTEs per week of term — when the load actually lands ── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2">
          <h2 className="text-sm font-semibold text-slate-700">Faculty &amp; preceptor FTEs per week of term</h2>
          <p className="text-[11px] text-slate-400">The scheduling view: weekly FTE by week of term within each semester — the shape of the load. Where orange overtakes blue, clinicals start and preceptors become the constraint.</p>
        </div>
        <ColumnChart bands={weekBands} series={[{ name: "Faculty FTEs", color: FAC_COLOR }, { name: "Preceptor FTEs", color: PRE_COLOR }]} unit="weekly" leafMinWidth={34} />
      </section>

      {/* ── Clinical staffing by rotation type — where to shore up ── */}
      {rotBands.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2">
            <h2 className="text-sm font-semibold text-slate-700">Clinical staffing by rotation type — real weeks, days &amp; times</h2>
            <p className="text-[11px] text-slate-400">The clinical-coordinator view: which rotation settings need clinical faculty and preceptors in each real calendar week — each column names the setting and the days &amp; times its shifts run, grouped by week, semester and year. Take a column to that setting&apos;s partner sites.</p>
          </div>
          <ColumnChart bands={rotBands} series={[{ name: "Clinical faculty FTEs", color: FAC_COLOR }, { name: "Preceptor FTEs", color: PRE_COLOR }]} unit="weekly" leafMinWidth={40} vertLeafLabels />
        </section>
      )}

      </>)}

      {altitude === "day" && (<>
      <DayOrders rows={rows} />
      {/* ── The shift chart: every instance, day by day / week by week / term by term ── */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Every shift, day by day — and who staffs it</h2>
            <p className="text-[11px] text-slate-400">
              One bar per session instance (bar length = shift length). Shifts drive everything; the label on each bar says
              how many shifts, how long, the contact hours they generate, and the people who staff them.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-600">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" /> Class</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-500" /> Lab</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" /> Clinical</span>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {termGroups.map((tg) => {
            const closed = closedTerms.has(tg.ti);
            return (
              <div key={tg.ti}>
                {/* Term (semester) header */}
                <button
                  onClick={() => setClosedTerms((s2) => { const n = new Set(s2); n.has(tg.ti) ? n.delete(tg.ti) : n.add(tg.ti); return n; })}
                  className="flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 bg-slate-800 px-4 py-2 text-left text-slate-100 hover:bg-slate-700"
                >
                  <span className="text-sm font-semibold">{closed ? "▸" : "▾"} {tg.termName}</span>
                  <span className="text-[11px] text-slate-300 tabular-nums">
                    {tg.weeks.length} week{tg.weeks.length === 1 ? "" : "s"} · peak <strong className="text-emerald-300">{n1(tg.peakFacFte)} faculty FTE</strong>
                    {tg.peakPreFte > 0 && <> · peak <strong className="text-amber-300">{n1(tg.peakPreFte)} preceptor FTE</strong></>}
                    {" "}· {n0(tg.facHrs)} fac hrs{tg.preHrs > 0 ? ` · ${n0(tg.preHrs)} preceptor hrs` : ""} total
                  </span>
                </button>
                {!closed && tg.weeks.map((wk) => {
                  const wfte = weeklyByIso.get(wk.mondayIso);
                  return (
                    <div key={wk.mondayIso} className="border-t border-slate-100">
                      {/* Week header — the FTE math for this week, in numbers */}
                      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 bg-slate-50 px-4 py-1.5 text-[11px]">
                        <span className="font-semibold text-slate-700">Week of {fmtDateM(wk.mondayIso)}</span>
                        {wfte && (
                          <span className="tabular-nums text-slate-500">
                            instructors <strong className="text-slate-800">{n1(wfte.totalFacFte)} FTE → {wfte.facultyHeads} {wfte.facultyHeads === 1 ? "person" : "people"}</strong>
                            {" "}(<span className="text-sky-700">{n1(wfte.classFte)} class</span> · <span className="text-violet-700">{n1(wfte.labFte)} lab</span> · <span className="text-rose-700">{n1(wfte.clinicalFacFte)} clinical</span>)
                            {wfte.preceptorFte > 0 && <> · preceptors <strong className="text-amber-700">{n1(wfte.preceptorFte)} FTE → {wfte.preceptorHeads} people</strong></>}
                          </span>
                        )}
                      </div>
                      {/* Day columns: one vertical bar per instance — height = shift length */}
                      <div className="overflow-x-auto px-4 py-3">
                        <div className="flex items-end gap-5">
                          {wk.days.map(({ dateIso, list }) => {
                            const shifts = list.reduce((n2, r) => n2 + nz2(r.computed.Y), 0);
                            const inst = list.filter((r) => r.session.kind !== "CLINICAL").reduce((n2, r) => n2 + nz2(r.computed.Y) * (r.session.facultyNeeded ?? 0), 0);
                            const pre = list.filter((r) => r.session.kind === "CLINICAL").reduce((n2, r) => n2 + nz2(r.computed.Y) * (r.session.preceptorsNeeded ?? 0), 0);
                            const facH = list.reduce((n2, r) => n2 + nz2(r.computed.Z), 0);
                            const preH = list.reduce((n2, r) => n2 + nz2(r.computed.AC), 0);
                            return (
                              <div key={dateIso} className="flex shrink-0 flex-col">
                                <div className="flex items-end gap-2">
                                  {list.map((r, i) => {
                                    const Y = nz2(r.computed.Y);
                                    const len = r.session.lengthHours ?? 0;
                                    const clin = r.session.kind === "CLINICAL";
                                    const people = clin ? Y * (r.session.preceptorsNeeded ?? 0) : Y * (r.session.facultyNeeded ?? 0);
                                    const hrs = clin ? nz2(r.computed.AC) : nz2(r.computed.Z);
                                    const tip = `${r.session.startTime ? r.session.startTime + " · " : ""}${r.courseCode ?? r.courseTitle}${r.session.title ? ` — ${r.session.title}` : ""} · ${len}h × ${n0(Y)} shift${Y === 1 ? "" : "s"} = ${clin ? n0(hrs) : n1(hrs)} ${clin ? "preceptor" : "fac"} contact hrs · ${clin ? n0(people) : n1(people)} ${clin ? "preceptors" : "instructors"}${clin && r.session.rotationType ? ` @ ${r.session.rotationType}` : ""}${clin && nz2(r.computed.Z) > 0 ? ` · +${n1(nz2(r.computed.Z))}h fac oversight` : ""} · ${r.cohort}`;
                                    return (
                                      <div key={i} className="flex w-14 shrink-0 flex-col items-center" title={tip}>
                                        <span className="text-[9px] font-semibold tabular-nums leading-tight text-slate-700">{len}h × {n0(Y)}</span>
                                        <span className={`text-[9px] tabular-nums leading-tight ${clin ? "text-amber-700" : "text-emerald-700"}`}>{clin ? `${n0(people)} prec` : `${n1(people)} inst`}</span>
                                        <div className="mt-0.5 w-9 rounded-t-[4px]" style={{ height: Math.max(6, Math.round((len / maxLen) * 110)), background: KIND_COLORS[r.session.kind] ?? "#64748b" }} />
                                        <span className="mt-1 font-mono text-[9px] leading-tight text-slate-500">{r.session.startTime ?? "—"}</span>
                                        <span className="w-full truncate text-center text-[9px] font-medium leading-tight text-slate-600">{r.courseCode ?? r.courseTitle}</span>
                                        <span className="text-[9px] leading-tight text-slate-400">{clin ? `${n0(hrs)}h prec` : `${n1(hrs)}h fac`}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                                <div className="mt-1 border-t-2 border-slate-300 pt-1 text-center text-[10px] font-semibold text-slate-700">
                                  {fmtDay(dateIso)}
                                  <span className="block text-[9px] font-normal text-slate-500">
                                    {n0(shifts)} shift{shifts === 1 ? "" : "s"} · {n1(inst)} inst{pre > 0 ? ` · ${n0(pre)} prec` : ""} · {n0(facH)}h fac{preH > 0 ? ` · ${n0(preH)}h prec` : ""}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {wk.undated.length > 0 && (
                          <p className="text-[11px] text-slate-400">
                            + {wk.undated.length} session{wk.undated.length === 1 ? "" : "s"} without a set day (async / day not set) — counted in the week totals.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>

      </>)}

      {altitude === "semester" && (<>
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
      </>)}

    </div>
  );
}


// ───────────── Staffing orders — statement first: how many people, at which times ─────────────
const ceilP = (v: number) => Math.max(0, Math.ceil(v - 1e-9));
const median = (xs: number[]) => { if (!xs.length) return 0; const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const endTime = (t: string | null, len: number) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const mins = h * 60 + m + Math.round(len * 60);
  return `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
};

/** Semester altitude: one staffing order per term — every week's people, the heaviest week called out. */
function TermOrders({ rows }: { rows: DatedInstance[] }) {
  const terms = [...new Set(rows.map((r) => r.termIndex))].sort((a, b) => a - b);
  return (
    <div className="space-y-4">
      {terms.map((ti) => {
        const tr = rows.filter((r) => r.termIndex === ti);
        const weeks = weeklyNeedByKind(tr).filter((w) => w.totalFacFte > 0 || w.preceptorFte > 0);
        if (!weeks.length) return null;
        const first = weeks[0].mondayIso, last = weeks[weeks.length - 1].mondayIso;
        const instOf = (w: (typeof weeks)[number]) => ceilP(w.classFte) + ceilP(w.labFte) + ceilP(w.clinicalFacFte);
        const preOf = (w: (typeof weeks)[number]) => ceilP(w.preceptorFte);
        const typInst = Math.round(median(weeks.map(instOf)));
        const typPre = Math.round(median(weeks.map(preOf)));
        const peak = weeks.reduce((b, w) => (instOf(w) + preOf(w) > instOf(b) + preOf(b) ? w : b), weeks[0]);
        return (
          <section key={ti} className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-800 px-5 py-3 text-slate-100">
              <div className="text-base font-semibold">{tr[0].termName} — {tr[0].semester} {first.slice(0, 4)} <span className="font-normal text-slate-300">· {fmtDateM(first)} → {fmtDateM(addDays7(last))} · {weeks.length} weeks</span></div>
              <p className="mt-1 text-sm leading-relaxed text-slate-200">
                To run this term, staff <strong className="text-white">{typInst} instructor{typInst === 1 ? "" : "s"}</strong>{typPre > 0 && <> and <strong className="text-amber-300">{typPre} preceptor{typPre === 1 ? "" : "s"}</strong></>} in a typical week.
                {" "}The heaviest week is the week of <strong className="text-white">{fmtDateM(peak.mondayIso)}</strong>: <strong className="text-white">{instOf(peak)} instructors</strong>{preOf(peak) > 0 && <> + <strong className="text-amber-300">{preOf(peak)} preceptors</strong></>}.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 font-semibold">Week of</th>
                    <th className="px-3 py-2 text-right font-semibold text-sky-700">Class instructors</th>
                    <th className="px-3 py-2 text-right font-semibold text-violet-700">Lab instructors</th>
                    <th className="px-3 py-2 text-right font-semibold text-rose-700">Clinical faculty</th>
                    <th className="px-3 py-2 text-right font-semibold">Instructors, total</th>
                    <th className="px-3 py-2 text-right font-semibold text-amber-700">Preceptors</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w) => {
                    const isPeak = w.mondayIso === peak.mondayIso;
                    return (
                      <tr key={w.mondayIso} className={`border-b border-slate-100 ${isPeak ? "bg-rose-50" : ""}`}>
                        <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-700">{fmtDateM(w.mondayIso)}{isPeak && <span className="ml-2 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white">heaviest</span>}</td>
                        <td className="px-3 py-2 text-right text-lg tabular-nums text-slate-800">{ceilP(w.classFte) || <span className="text-slate-300">·</span>}</td>
                        <td className="px-3 py-2 text-right text-lg tabular-nums text-slate-800">{ceilP(w.labFte) || <span className="text-slate-300">·</span>}</td>
                        <td className="px-3 py-2 text-right text-lg tabular-nums text-slate-800">{ceilP(w.clinicalFacFte) || <span className="text-slate-300">·</span>}</td>
                        <td className="px-3 py-2 text-right text-xl font-bold tabular-nums text-slate-900">{instOf(w)}</td>
                        <td className="px-3 py-2 text-right text-xl font-bold tabular-nums text-amber-700">{preOf(w) || <span className="font-normal text-slate-300">·</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
const addDays7 = (iso: string) => new Date(new Date(iso + "T00:00:00Z").getTime() + 6 * 86400000).toISOString().slice(0, 10);
const addDaysN = (iso: string, n: number) => new Date(new Date(iso + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);

/** One time block on one day: who is needed, for what. */
interface Block { time: string | null; end: string | null; instructors: number; preceptors: number; items: string[]; unassigned: number }
function blocksFor(dayRows: DatedInstance[]): Block[] {
  const by = new Map<string, Block>();
  for (const r of dayRows) {
    const t = r.session.startTime ?? null;
    const key = t ?? "—";
    const b = by.get(key) ?? { time: t, end: endTime(t, r.session.lengthHours), instructors: 0, preceptors: 0, items: [], unassigned: 0 };
    const Y = nz2(r.computed.Y);
    const clin = r.session.kind === "CLINICAL";
    const people = clin ? Y * (r.session.preceptorsNeeded ?? 0) : Y * (r.session.facultyNeeded ?? 0);
    if (clin) b.preceptors += people; else b.instructors += people;
    if (!r.session.staffName) b.unassigned += Y;
    b.items.push(`${r.courseCode ?? r.courseTitle} ${r.session.kind.toLowerCase()}${Y > 1 ? ` ×${n0(Y)} sections` : ""}${clin && r.session.rotationType ? ` @ ${r.session.rotationType}` : r.session.location ? ` · ${r.session.location}` : ""}${r.session.staffName ? ` · ${r.session.staffName}` : ""}`);
    if (b.end && r.session.lengthHours) { const e2 = endTime(t, r.session.lengthHours); if (e2 && e2 > b.end) b.end = e2; }
    by.set(key, b);
  }
  return [...by.values()].sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));
}

/** Week altitude: pick a week, read each day as a staffing order by time block. */
function WeekOrders({ rows }: { rows: DatedInstance[] }) {
  const mondays = useMemo(() => [...new Set(rows.map((r) => r.mondayIso!).filter(Boolean))].sort(), [rows]);
  const [idx, setIdx] = useState(0);
  const monday = mondays[Math.min(idx, mondays.length - 1)];
  if (!monday) return null;
  const days = Array.from({ length: 7 }, (_, i) => addDaysN(monday, i));
  const dayRows = (iso: string) => rows.filter((r) => r.dateIso === iso);
  const totals = days.map((iso) => { const bs = blocksFor(dayRows(iso)); return { iso, inst: bs.reduce((n, b) => n + b.instructors, 0), pre: bs.reduce((n, b) => n + b.preceptors, 0), blocks: bs }; });
  const weekInst = Math.max(0, ...totals.map((t) => ceilP(t.inst)));
  const weekPre = Math.max(0, ...totals.map((t) => ceilP(t.pre)));
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40">←</button>
          <span className="min-w-[14rem] text-center text-base font-semibold text-slate-800">Week of {fmtDateM(monday)}</span>
          <button onClick={() => setIdx((i) => Math.min(mondays.length - 1, i + 1))} disabled={idx >= mondays.length - 1} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40">→</button>
          <span className="text-xs text-slate-400">{idx + 1} of {mondays.length} weeks</span>
        </div>
        <p className="text-sm text-slate-700">
          This week needs up to <strong>{weekInst} instructor{weekInst === 1 ? "" : "s"}</strong>{weekPre > 0 && <> and <strong className="text-amber-700">{weekPre} preceptor{weekPre === 1 ? "" : "s"}</strong></>} on a single day.
        </p>
      </div>
      <div className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-7 md:divide-x md:divide-y-0">
        {totals.map((t) => (
          <div key={t.iso} className="p-3">
            <div className="text-sm font-semibold text-slate-800">{new Date(t.iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" })}</div>
            {t.blocks.length === 0 ? (
              <div className="mt-1 text-xs text-slate-300">nothing scheduled</div>
            ) : (
              <>
                <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{ceilP(t.inst)}<span className="text-xs font-medium text-slate-500"> inst</span>{t.pre > 0 && <span className="ml-2 text-amber-700">{ceilP(t.pre)}<span className="text-xs font-medium"> prec</span></span>}</div>
                <div className="mt-2 space-y-1.5">
                  {t.blocks.map((b, i) => (
                    <div key={i} className="rounded-lg bg-slate-50 p-2 text-[11px] leading-snug">
                      <div className="font-semibold text-slate-700">{b.time ? `${fmtT2(b.time)}${b.end ? ` – ${fmtT2(b.end)}` : ""}` : "time not set"} · {ceilP(b.instructors) ? `${ceilP(b.instructors)} instructor${ceilP(b.instructors) === 1 ? "" : "s"}` : ""}{ceilP(b.instructors) && ceilP(b.preceptors) ? " + " : ""}{ceilP(b.preceptors) ? `${ceilP(b.preceptors)} preceptor${ceilP(b.preceptors) === 1 ? "" : "s"}` : ""}</div>
                      {b.items.map((it, j) => <div key={j} className="text-slate-500">{it}</div>)}
                      {b.unassigned > 0 && <div className="font-medium text-amber-700">{n0(b.unassigned)} shift{b.unassigned === 1 ? "" : "s"} unassigned</div>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Day altitude: one day as a staffing roster — time, what, who is needed, who is assigned. */
function DayOrders({ rows }: { rows: DatedInstance[] }) {
  const dates = useMemo(() => [...new Set(rows.map((r) => r.dateIso!).filter(Boolean))].sort(), [rows]);
  const [idx, setIdx] = useState(0);
  const iso = dates[Math.min(idx, dates.length - 1)];
  if (!iso) return null;
  const dayRows = rows.filter((r) => r.dateIso === iso).sort((a, b) => (a.session.startTime ?? "99").localeCompare(b.session.startTime ?? "99"));
  const inst = dayRows.filter((r) => r.session.kind !== "CLINICAL").reduce((n, r) => n + nz2(r.computed.Y) * (r.session.facultyNeeded ?? 0), 0);
  const pre = dayRows.filter((r) => r.session.kind === "CLINICAL").reduce((n, r) => n + nz2(r.computed.Y) * (r.session.preceptorsNeeded ?? 0), 0);
  const shifts = dayRows.reduce((n, r) => n + nz2(r.computed.Y), 0);
  const unassigned = dayRows.filter((r) => !r.session.staffName).reduce((n, r) => n + nz2(r.computed.Y), 0);
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40">←</button>
          <span className="min-w-[16rem] text-center text-base font-semibold text-slate-800">{fmtDate(iso)}</span>
          <button onClick={() => setIdx((i) => Math.min(dates.length - 1, i + 1))} disabled={idx >= dates.length - 1} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40">→</button>
          <span className="text-xs text-slate-400">{idx + 1} of {dates.length} days</span>
        </div>
      </div>
      <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 text-base text-slate-800">
        To run this day you need <strong>{ceilP(inst)} instructor{ceilP(inst) === 1 ? "" : "s"}</strong>{pre > 0 && <> and <strong className="text-amber-700">{ceilP(pre)} preceptor{ceilP(pre) === 1 ? "" : "s"}</strong></>} across <strong>{n0(shifts)} shift{shifts === 1 ? "" : "s"}</strong>
        {unassigned > 0 ? <> — <strong className="text-amber-700">{n0(unassigned)} still have no one assigned</strong>.</> : <> — everyone is assigned.</>}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-white text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2 font-semibold">Time</th>
            <th className="px-3 py-2 font-semibold">Shift</th>
            <th className="px-3 py-2 text-right font-semibold">Students</th>
            <th className="px-3 py-2 text-right font-semibold">Hours</th>
            <th className="px-3 py-2 font-semibold">Needs</th>
            <th className="px-3 py-2 font-semibold">Where</th>
            <th className="px-3 py-2 font-semibold">Assigned</th>
          </tr>
        </thead>
        <tbody>
          {dayRows.map((r, i) => {
            const Y = nz2(r.computed.Y);
            const clin = r.session.kind === "CLINICAL";
            const people = clin ? Y * (r.session.preceptorsNeeded ?? 0) : Y * (r.session.facultyNeeded ?? 0);
            const t = r.session.startTime ?? null;
            return (
              <tr key={i} className="border-b border-slate-100">
                <td className="whitespace-nowrap px-4 py-2 font-mono tabular-nums text-slate-700">{t ? `${fmtT2(t)} – ${fmtT2(endTime(t, r.session.lengthHours)!)}` : "not set"}</td>
                <td className="px-3 py-2">
                  <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-sm ${r.session.kind === "CLASS" ? "bg-sky-500" : r.session.kind === "LAB" ? "bg-violet-500" : "bg-rose-500"}`} />
                  <span className="font-medium text-slate-800">{r.courseCode ?? r.courseTitle}</span> <span className="text-slate-500">{r.session.kind.toLowerCase()}{Y > 1 ? ` × ${n0(Y)} sections` : ""}</span>
                  {r.session.title && <span className="block text-xs text-slate-400">“{r.session.title}”</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{n0(Math.min(r.computed.C, Y * (r.session.maxStudents ?? 0)))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.session.lengthHours}h</td>
                <td className="px-3 py-2 font-semibold">{clin ? <span className="text-amber-700">{n0(people)} preceptor{people === 1 ? "" : "s"}</span> : <span className="text-emerald-700">{n1(people)} instructor{people === 1 ? "" : "s"}</span>}</td>
                <td className="px-3 py-2 text-slate-600">{clin ? (r.session.rotationType ? `@ ${r.session.rotationType}` : "setting not set") : (r.session.location ?? "no room")}</td>
                <td className={`px-3 py-2 ${r.session.staffName ? "text-slate-700" : "font-medium text-amber-700"}`}>{r.session.staffName ?? "unassigned"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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

      {/* Preceptor hours week by week — every cap labeled */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2">
          <h2 className="text-sm font-semibold text-slate-700">Preceptor contact hours, week by week</h2>
          <p className="text-[11px] text-slate-400">The hours partner sites must absorb each calendar week — the number on each column is the ask.</p>
        </div>
        <ColumnChart
          bands={[{ label: "", groups: [{ label: "", leaves: [...sumBy(clinical, (i) => i.mondayIso, "preTotal").entries()].filter(([k]) => k != null).sort((a, b) => (a[0] as string).localeCompare(b[0] as string)).map(([k, v]) => ({ label: fmtDateM(k as string).replace(", 20", " '"), title: `Week of ${fmtDateM(k as string)}`, values: [v] })) }] }]}
          series={[{ name: "Preceptor contact hours", color: PRE_COLOR }]}
          unit="hrs" leafMinWidth={44} vertLeafLabels
        />
      </section>
    </div>
  );
}

/** Weekly clinical gap: peak-day students needing a slot vs site supply — the
 *  shore-up-clinicals chart. Green = covered, red = students without a slot;
 *  the dashed line is the supply ceiling. */
function GapChart({ rows, supply }: { rows: DatedInstance[]; supply: number }) {
  const byWeek = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.dateIso || !r.mondayIso) continue;
    const students = Math.min(r.computed.C, nz2(r.computed.Y) * (r.session.maxStudents ?? 0));
    const w = byWeek.get(r.mondayIso) ?? new Map<string, number>();
    w.set(r.dateIso, (w.get(r.dateIso) ?? 0) + students);
    byWeek.set(r.mondayIso, w);
  }
  const weeks = [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mondayIso, days]) => ({ mondayIso, demand: Math.max(0, ...days.values()) }));
  if (!weeks.length) return null;
  const H = 130;
  const max = Math.max(supply, ...weeks.map((w) => w.demand), 1);
  const supplyY = Math.round((supply / max) * H);
  const shortWeeks = weeks.filter((w) => w.demand > supply).length;
  const fmtShort = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });
  return (
    <div className="border-t border-slate-100 px-4 py-3">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">The gap, week by week — students on the heaviest day vs slots the sites offer</div>
        <div className="flex items-center gap-3 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#0ca30c" }} /> covered</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#d03b3b" }} /> ⚠ no slot</span>
          <span className="text-slate-400">- - supply {n0(supply)}/day</span>
        </div>
      </div>
      {shortWeeks > 0 && (
        <p className="mb-2 text-[11px] font-medium text-rose-700">⚠ {n0(shortWeeks)} of {n0(weeks.length)} clinical weeks exceed site supply — every red block is students with nowhere to go.</p>
      )}
      <div className="overflow-x-auto pb-1">
        <div className="relative inline-flex items-end gap-[3px] border-b border-slate-300 pr-24" style={{ height: H + 16 }}>
          {/* supply ceiling */}
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-500" style={{ bottom: supplyY }}>
            <span className="absolute right-0 -translate-y-1/2 bg-white px-1 text-[9px] text-slate-500">supply {n0(supply)}/day</span>
          </div>
          {weeks.map((w) => {
            const covered = Math.min(w.demand, supply);
            const over = Math.max(0, w.demand - supply);
            const hC = Math.round((covered / max) * H);
            const hO = Math.round((over / max) * H);
            return (
              <div key={w.mondayIso} className="flex w-7 shrink-0 flex-col items-center justify-end" title={`Week of ${fmtDateM(w.mondayIso)} — ${n0(w.demand)} students on the heaviest day; supply ${n0(supply)}${over > 0 ? `; ${n0(over)} without a slot` : ""}`}>
                <span className={`mb-0.5 text-[9px] font-medium tabular-nums leading-none ${over > 0 ? "text-rose-700" : "text-slate-600"}`}>{n0(w.demand)}</span>
                {over > 0 && <div className="w-full max-w-[20px] rounded-t-[4px]" style={{ height: Math.max(2, hO), background: "#d03b3b" }} />}
                <div className={`w-full max-w-[20px] ${over > 0 ? "mt-[2px]" : "rounded-t-[4px]"}`} style={{ height: Math.max(2, hC), background: "#0ca30c" }} />
              </div>
            );
          })}
        </div>
        <div className="inline-flex gap-[3px] pr-24">
          {weeks.map((w, i) => (
            <span key={w.mondayIso} className="w-7 shrink-0 whitespace-nowrap text-center text-[8px] tabular-nums text-slate-400">{i % 4 === 0 ? fmtMD(w.mondayIso) : ""}</span>
          ))}
        </div>
        <div className="pr-24 text-right text-[10px] text-slate-400">{fmtShort(weeks[0].mondayIso)} → {fmtShort(weeks[weeks.length - 1].mondayIso)}</div>
      </div>
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
      <GapChart rows={rows} supply={supply} />
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

// ───────────────────────────── 05 · Daily coverage ───────────────────────────
// The calendar itself (semester / month / week / day, draggable shifts, inline
// shift editors) lives in CoverageCalendar; the printable per-date list stays here.
function CoverageView({ rows, cohorts, rooms, people, sites }: {
  rows: DatedInstance[]; cohorts: CapacityCohort[];
  rooms: CalRoom[]; people: CalPerson[]; sites: ClinicalSite[];
}) {
  const board = useMemo(() => shiftBoard(rows), [rows]);
  return (
    <div className="space-y-4">
      <CoverageCalendar
        rows={rows} cohorts={cohorts} rooms={rooms} people={people}
        sites={sites.filter((x) => x.status === "active").map((x) => ({ id: x.id, name: x.name }))}
      />
      {board.length > 0 && (
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
                  <th className="px-3 py-2 text-right font-semibold">Shifts</th>
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
      )}
    </div>
  );
}
