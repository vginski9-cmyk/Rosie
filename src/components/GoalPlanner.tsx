"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BENCHMARK_RATES, RATE_DEFS, UTILIZATION_BENCHMARK,
  buildLadder, capacityFromNorthStar, utilization, roundLadder,
  type LadderRates,
} from "@/lib/northstar";
import { deriveCohortTargets } from "@/lib/pipeline";
import { saveFamilyGoalPlan, lockInInstantiation, unlockInstantiation, saveCohortPipeline } from "@/lib/actions";

// The North-Star goal surface. Set a multi-year goal — one clean number per year,
// stairstep up / hold / shrink. Under each year sit the instantiations (cohorts)
// graduating that year, with the goal already set and the ACTUAL sourced live from
// the student database. Click a year to plan its full pipeline below.

type Anchor = "northstar" | "capacity";

export interface Instantiation {
  id: string;
  name: string;
  programId: string;
  program: string;
  goalProductive: number;
  students: number;
  enrolled: number;
  completed: number;
  placed: number;
  status: string;
  /** Cohort-specific pipeline plan JSON ({ goal, rates, termOverrides }) — null = family defaults. */
  pipelineRates?: string | null;
  /** Number of terms in this instantiation's template. */
  terms?: number;
  phase: string;              // recruiting | in-program | graduated | unscheduled
  currentTerm: string | null; // current term name (when in-program)
  endLabel: string | null;    // expected-end label, e.g. "ends May 2026"
}

const PHASE_BADGE: Record<string, string> = {
  recruiting: "bg-sky-100 text-sky-700", "in-program": "bg-emerald-100 text-emerald-700",
  graduated: "bg-slate-200 text-slate-600", unscheduled: "bg-slate-100 text-slate-400",
};
const PHASE_LABEL: Record<string, string> = {
  recruiting: "recruiting", "in-program": "in program", graduated: "graduated", unscheduled: "unscheduled",
};

/** Live actual funnel for a year, summed from the student database (cumulative). */
export interface ActualFunnel {
  interested: number; qualified: number; offered: number; enrolled: number;
  completing: number; licensed: number; placed: number; productive: number;
}

/** Actual health-metric ratio for one rate, computed from the live funnel + capacity. */
function actualRateOf(key: keyof LadderRates, a: ActualFunnel, cap: number): number | null {
  switch (key) {
    case "interestedSurplus": return cap ? a.interested / cap : null;
    case "qualifiedSurplus": return cap ? a.qualified / cap : null;
    case "offeredSurplus": return cap ? a.offered / cap : null;
    case "enrollmentRate": return cap ? a.enrolled / cap : null;
    case "completionRate": return a.enrolled ? a.completing / a.enrolled : null;
    case "licensureRate": return a.completing ? a.licensed / a.completing : null;
    case "placementRate": return a.licensed ? a.placed / a.licensed : null;
    case "productivityRate": return a.placed ? a.productive / a.placed : null;
  }
}

export interface DeliveryModel {
  programId: string;
  name: string;
  credential: string | null;
  terms: number;
  /** Total instructional weeks across the template's terms (for the stop date). */
  spanWeeks: number;
  /** Max cohort enrollment capacity — the gating criterion when splitting a goal. */
  maxCapacity: number | null;
  running: number;
}

/** One planned run of a delivery model inside an allocation. */
interface OfferingSlot {
  /** Planned first day (ISO date). Required to lock in. */
  startDate: string | null;
  /** Locked in: the real cohort this run became. */
  locked?: boolean;
  cohortId?: string | null;
  cohortName?: string | null;
}

/** One slice of a year's goal, assigned to a delivery model. */
interface Alloc {
  programId: string;
  /** Fully-productive workers this model is responsible for (across all its offerings). */
  goal: number;
  /** Optional per-term enrollment overrides (index 0 = term 1). */
  termOverrides?: (number | null)[];
  /** User-chosen number of offerings — overrides the suggested count (add or
   *  subtract runs and sequence them however they add up to the goal). */
  offeringCount?: number;
  /** The runs of this model that deliver the share — one per needed offering. */
  offerings?: OfferingSlot[];
  /** Legacy single-offering fields (migrated into offerings[0]). */
  startDate?: string | null;
  locked?: boolean;
  cohortId?: string | null;
  cohortName?: string | null;
}

interface Persisted {
  anchor: Anchor;
  years: number[];
  goalsByYear: Record<string, number>;
  capByYear: Record<string, number>;
  selectedYear: number;
  goal: LadderRates;
  actual: LadderRates;
  /** Year → the delivery-model breakdown responsible for that goal. */
  allocationsByYear?: Record<string, Alloc[]>;
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const pctOf = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const num = (v: number) => Math.round(v).toLocaleString();

function attainColor(a: number | null): string {
  if (a == null) return "text-slate-400";
  if (a >= 1) return "text-emerald-600";
  if (a >= 0.85) return "text-amber-600";
  return "text-rose-600";
}

export function GoalPlanner({
  familyId, familyName, seedYears, seedGoalsByYear, savedPlan, instantiationsByYear = {}, actualByYear = {}, nowYear, models = [],
}: {
  familyId: string;
  familyName: string;
  seedYears: number[];
  seedGoalsByYear: Record<number, number>;
  savedPlan: string | null;
  instantiationsByYear?: Record<number, Instantiation[]>;
  actualByYear?: Record<number, ActualFunnel>;
  nowYear: number;
  models?: DeliveryModel[];
}) {
  const initial: Persisted = useMemo(() => {
    const years = (seedYears.length ? seedYears : [new Date().getFullYear() + 2]).slice().sort((a, b) => a - b);
    const goalsByYear: Record<string, number> = {};
    let last = 25;
    for (const y of years) { const g = Math.round(seedGoalsByYear[y] ?? 0) || last; goalsByYear[String(y)] = g; last = g; }
    const capByYear: Record<string, number> = {};
    for (const y of years) capByYear[String(y)] = Math.round(capacityFromNorthStar(goalsByYear[String(y)], BENCHMARK_RATES));
    // Open on the latest year with live student data (else latest with a cohort, else last).
    const withData = years.filter((y) => (actualByYear[y]?.interested ?? 0) > 0);
    const withCohorts = years.filter((y) => (instantiationsByYear[y]?.length ?? 0) > 0);
    const pool = withData.length ? withData : withCohorts;
    const defaultYear = pool.length ? pool[pool.length - 1] : years[years.length - 1];
    const base: Persisted = {
      anchor: "northstar", years, goalsByYear, capByYear,
      selectedYear: defaultYear,
      goal: { ...BENCHMARK_RATES }, actual: { ...BENCHMARK_RATES },
    };
    if (savedPlan) {
      try {
        const saved = JSON.parse(savedPlan) as Partial<Persisted>;
        const merged: Persisted = {
          ...base, ...saved,
          goal: { ...base.goal, ...saved.goal }, actual: { ...base.actual, ...saved.actual },
          goalsByYear: { ...base.goalsByYear, ...saved.goalsByYear }, capByYear: { ...base.capByYear, ...saved.capByYear },
        };
        if (!merged.years.includes(merged.selectedYear)) merged.selectedYear = merged.years[merged.years.length - 1];
        return merged;
      } catch { /* fall through */ }
    }
    return base;
  }, [seedYears, seedGoalsByYear, savedPlan, instantiationsByYear, actualByYear]);

  const [s, setS] = useState<Persisted>(initial);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setSaveState("saving");
    const t = setTimeout(() => {
      saveFamilyGoalPlan(familyId, JSON.stringify(s)).then(() => setSaveState("saved")).catch(() => setSaveState("idle"));
    }, 700);
    return () => clearTimeout(t);
  }, [s, familyId]);

  const capacityForYear = (year: number): number =>
    s.anchor === "northstar" ? capacityFromNorthStar(s.goalsByYear[String(year)] ?? 0, s.goal) : (s.capByYear[String(year)] ?? 0);
  const productiveForYear = (year: number): number => buildLadder(capacityForYear(year), s.goal).productive;

  const goalCapacity = capacityForYear(s.selectedYear);
  const goalLadder = roundLadder(buildLadder(goalCapacity, s.goal));
  // ACTUAL is sourced live from the student database (no manual entry).
  const actualFunnel: ActualFunnel | null = actualByYear[s.selectedYear] ?? null;
  const hasActual = actualFunnel != null && (actualFunnel.interested > 0 || actualFunnel.enrolled > 0);
  const goalUtil = utilization(goalLadder.productive, goalCapacity);
  const actualUtil = actualFunnel ? utilization(actualFunnel.productive, goalCapacity) : null;

  const setYearValue = (year: number, v: number) => setS((p) => {
    const k = String(year);
    return p.anchor === "northstar"
      ? { ...p, goalsByYear: { ...p.goalsByYear, [k]: Math.max(0, v) } }
      : { ...p, capByYear: { ...p.capByYear, [k]: Math.max(0, v) } };
  });
  const selectYear = (year: number) => setS((p) => ({ ...p, selectedYear: year }));
  const addYear = () => setS((p) => {
    const next = (p.years[p.years.length - 1] ?? new Date().getFullYear()) + 1;
    const lastG = p.goalsByYear[String(p.years[p.years.length - 1])] ?? 25;
    const lastC = p.capByYear[String(p.years[p.years.length - 1])] ?? Math.round(capacityFromNorthStar(lastG, p.goal));
    return { ...p, years: [...p.years, next], goalsByYear: { ...p.goalsByYear, [String(next)]: lastG }, capByYear: { ...p.capByYear, [String(next)]: lastC } };
  });
  const removeYear = () => setS((p) => {
    if (p.years.length <= 1) return p;
    const years = p.years.slice(0, -1);
    return { ...p, years, selectedYear: years.includes(p.selectedYear) ? p.selectedYear : years[years.length - 1] };
  });

  const setGoalRate = (k: keyof LadderRates, vPct: number) => setS((p) => ({ ...p, goal: { ...p.goal, [k]: vPct / 100 } }));
  const resetBenchmark = () => setS((p) => ({ ...p, goal: { ...BENCHMARK_RATES } }));
  const attain = (g: number, a: number | null) => (a != null && g > 0 ? a / g : null);

  // --- Goal breakdown: delivery models → instantiations responsible for it ---
  const yearKey = String(s.selectedYear);
  const allocs: Alloc[] = s.allocationsByYear?.[yearKey] ?? [];
  const yearGoal = Math.round(s.anchor === "northstar" ? (s.goalsByYear[yearKey] ?? 0) : productiveForYear(s.selectedYear));
  const allocated = allocs.reduce((n, a) => n + a.goal, 0);
  const remaining = yearGoal - allocated;
  const setAllocs = (next: Alloc[]) => setS((p) => ({ ...p, allocationsByYear: { ...(p.allocationsByYear ?? {}), [yearKey]: next } }));
  const addAlloc = (programId: string) => {
    if (allocs.some((a) => a.programId === programId)) return;
    const m = models.find((x) => x.programId === programId);
    setAllocs([...allocs, { programId, goal: Math.max(0, remaining), offerings: [{ startDate: m ? suggestStart(m) : null }] }]);
  };

  /** The runs an allocation needs, sized to the model's max cohort capacity —
   *  but the COUNT is yours: add or subtract offerings (a.offeringCount) and
   *  sequence them however they add up to the goal. More demand than one
   *  cohort can seat is NOT "over capacity" — it just takes more offerings.
   *  Locked slots are always preserved. */
  const slotsFor = (a: Alloc, suggested: number): OfferingSlot[] => {
    const legacy: OfferingSlot[] = a.offerings ?? (a.startDate != null || a.locked ? [{ startDate: a.startDate ?? null, locked: a.locked, cohortId: a.cohortId, cohortName: a.cohortName }] : []);
    const m = models.find((x) => x.programId === a.programId);
    const lockedCount = legacy.filter((o) => o.locked).length;
    const target = Math.max(1, lockedCount, a.offeringCount ?? suggested);
    const out = [...legacy];
    while (out.length < target) out.push({ startDate: out[out.length - 1]?.startDate ?? (m ? suggestStart(m) : null) });
    while (out.length > target && !out[out.length - 1].locked) out.pop();
    return out;
  };
  const [dragOver, setDragOver] = useState(false);
  const [lockingId, setLockingId] = useState<string | null>(null);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  /** Offering whose cohort-specific pipeline targets are open in the side panel. */
  const [targetsFor, setTargetsFor] = useState<string | null>(null);
  const allInsts = useMemo(() => Object.values(instantiationsByYear).flat(), [instantiationsByYear]);
  const router = useRouter();

  /** Suggested start so the cohort lands its graduates in the selected year. */
  const suggestStart = (m: DeliveryModel): string => {
    const spanYears = Math.max(1, Math.ceil((m.spanWeeks + 6) / 52));
    return `${s.selectedYear - spanYears}-08-15`;
  };
  const stopDateOf = (startIso: string | null | undefined, m: DeliveryModel): string | null => {
    if (!startIso) return null;
    const d = new Date(startIso + "T00:00:00Z");
    if (isNaN(d.getTime())) return null;
    // instructional weeks + ~2-week breaks between terms
    d.setUTCDate(d.getUTCDate() + (m.spanWeeks + Math.max(0, m.terms - 1) * 2) * 7);
    return d.toISOString().slice(0, 10);
  };
  const fmtMY = (iso: string | null) => (iso ? new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" }) : "—");

  /** Undo a lock-in: deletes the instantiation (confirmed), slot returns to a
   *  plannable start date. Students are detached, never deleted. */
  const unlock = async (ai: number, oi: number, slots: OfferingSlot[]) => {
    const a = allocs[ai];
    const slot = slots[oi];
    if (!slot?.locked) return;
    if (!window.confirm(`Unlock ${slot.cohortName ?? "this offering"}?\n\nThe instantiation is deleted — its schedule, bookings, session overrides and pipeline targets go with it. Enrolled students are kept but detached. The slot returns to a plannable start date.`)) return;
    setUnlockingId(`${a.programId}:${oi}`);
    try {
      if (slot.cohortId) await unlockInstantiation(slot.cohortId);
      const next = slots.map((x, j) => (j === oi ? { startDate: x.startDate ?? null } : x));
      setAllocs(allocs.map((x, i) => (i === ai ? { ...x, offerings: next, startDate: undefined, locked: undefined, cohortId: undefined, cohortName: undefined } : x)));
      router.refresh();
    } finally {
      setUnlockingId(null);
    }
  };

  const lockIn = async (ai: number, oi: number, goalShare: number, slots: OfferingSlot[]) => {
    const a = allocs[ai];
    const m = models.find((x) => x.programId === a.programId);
    const slot = slots[oi];
    if (!m || !slot?.startDate || slot.locked) return;
    setLockingId(`${a.programId}:${oi}`);
    try {
      const res = await lockInInstantiation(a.programId, familyId, { gradYear: s.selectedYear, goal: goalShare, startDate: slot.startDate });
      const next = slots.map((x, i) => (i === oi ? { ...x, locked: true, cohortId: res.cohortId, cohortName: res.name } : x));
      setAllocs(allocs.map((x, i) => (i === ai ? { ...x, offerings: next, startDate: undefined, locked: undefined, cohortId: undefined, cohortName: undefined } : x)));
      router.refresh();
    } finally {
      setLockingId(null);
    }
  };

  const af = actualFunnel;
  const ladderRows: { label: string; g: number; a: number | null; strong?: boolean }[] = [
    { label: "Interested candidates", g: goalLadder.interested, a: af?.interested ?? null },
    { label: "Qualified applicants", g: goalLadder.qualified, a: af?.qualified ?? null },
    { label: "Offered admission", g: goalLadder.offered, a: af?.offered ?? null },
    { label: "Enrollment capacity", g: goalLadder.enrolled, a: af?.enrolled ?? null, strong: true },
    { label: "Completing on time", g: goalLadder.completing, a: af?.completing ?? null },
    { label: "Passing licensure (first time)", g: goalLadder.licensed, a: af?.licensed ?? null },
    { label: "Retained & placed regionally", g: goalLadder.placed, a: af?.placed ?? null },
    { label: "Reaching full productivity", g: goalLadder.productive, a: af?.productive ?? null, strong: true },
  ];

  return (
    <div className="space-y-5">
      {/* Save state */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-[11px] text-slate-400">{saveState === "saving" ? "saving…" : saveState === "saved" ? "✓ saved" : ""}</span>
      </div>

      {/* Multi-year goals — clean numbers, instantiations under each year */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">The goal: fully-productive placements in the region, per year. Click a year to say who delivers it.</p>
          <div className="flex items-center gap-1">
            <button onClick={removeYear} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50" title="remove last year">−</button>
            <button onClick={addYear} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50" title="add a year">+ year</button>
          </div>
        </div>

        {/* The stairstep: one goal box per year, reading left → right. */}
        <div className="pb-1">
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            {s.years.map((year) => {
              const selected = year === s.selectedYear;
              const goalVal = s.anchor === "northstar" ? (s.goalsByYear[String(year)] ?? 0) : (s.capByYear[String(year)] ?? 0);
              const derived = s.anchor === "northstar" ? Math.round(capacityForYear(year)) : Math.round(productiveForYear(year));
              const insts = instantiationsByYear[year] ?? [];
              const actualProductive = insts.reduce((n, i) => n + i.placed, 0);
              return (
                <button key={year} onClick={() => selectYear(year)}
                  className={`rounded-xl border p-3 text-left ${selected ? "border-rose-400 bg-rose-50/50 ring-1 ring-rose-200" : "border-slate-200 bg-white hover:border-rose-200"} ${year === nowYear ? "outline outline-1 outline-offset-2 outline-rose-200" : ""}`}>
                  <span className={`block text-sm font-bold tabular-nums ${selected ? "text-rose-700" : "text-slate-700"}`}>{year}{year === nowYear ? " · now" : ""}</span>
                  <input
                    type="number" min={0} value={Math.round(goalVal)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setYearValue(year, Number(e.target.value) || 0)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-2xl font-bold tabular-nums text-slate-800 focus:border-rose-400 focus:outline-none"
                  />
                  <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-slate-400">fully productive placements</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* The selected year's instantiations — the classes delivering that goal. */}
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{s.selectedYear} — instantiations delivering this goal</div>
          {(instantiationsByYear[s.selectedYear] ?? []).length === 0 ? (
            <p className="text-xs text-slate-300">
              {s.selectedYear < nowYear ? `No instantiations graduated in ${s.selectedYear}.` : s.selectedYear === nowYear ? `No instantiations graduating in ${s.selectedYear}.` : `No instantiations planned for ${s.selectedYear} yet.`}
            </p>
          ) : (
            <div className="space-y-1.5">
              {(instantiationsByYear[s.selectedYear] ?? []).map((c) => (
                <div key={c.id} className="flex items-stretch gap-2">
                <button onClick={() => setTargetsFor(targetsFor === c.id ? null : c.id)} className={`shrink-0 rounded-lg border px-2.5 text-[11px] font-medium ${targetsFor === c.id ? "border-rose-400 bg-rose-600 text-white" : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"}`} title="set this offering's own talent-pipeline targets">⚙ targets</button>
                <Link href={`/programs/${c.programId}/offerings/${c.id}`} className="flex-1 rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 text-[13px] hover:border-rose-200 hover:bg-rose-50/40 block">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-slate-800">
                      {c.name} <span className="font-normal text-slate-400">· {c.program}</span>
                      <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${PHASE_BADGE[c.phase] ?? PHASE_BADGE.unscheduled}`}>{PHASE_LABEL[c.phase] ?? c.phase}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-3 tabular-nums text-slate-500">
                      <span>goal <strong className="text-slate-700">{c.goalProductive || "—"}</strong></span>
                      <span className="text-slate-300">·</span>
                      <span title="live from student data">{c.students} students</span>
                      <span className="text-emerald-600">{c.enrolled} enrolled</span>
                      <span className="text-lime-600">{c.completed} completed</span>
                      <span className="text-rose-600">{c.placed} placed</span>
                    </span>
                  </span>
                  {(c.currentTerm || c.endLabel) && (
                    <span className="mt-0.5 block text-[11px] text-slate-400">
                      {c.phase === "in-program" && c.currentTerm ? `Now in ${c.currentTerm}` : c.phase === "recruiting" ? "Starts soon" : ""}
                      {c.currentTerm && c.endLabel ? " · " : ""}{c.endLabel ?? ""}
                    </span>
                  )}
                </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Break the goal down: drag delivery models into the box that owns it */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-700">{s.selectedYear} — who delivers this goal</h3>
          <span className="text-[11px] tabular-nums">
            goal <strong className="text-slate-800">{yearGoal}</strong> · allocated <strong className={allocated === yearGoal ? "text-emerald-600" : "text-slate-800"}>{allocated}</strong> ·{" "}
            <strong className={remaining === 0 ? "text-emerald-600" : remaining > 0 ? "text-amber-600" : "text-rose-600"}>{remaining === 0 ? "fully covered" : remaining > 0 ? `${remaining} uncovered` : `${-remaining} over`}</strong>
          </span>
        </div>
        <p className="mb-3 text-[11px] text-slate-400">
          Drag a delivery model into the box (or click +) and split the {yearGoal || "—"} fully-productive workers across
          the instantiations responsible for delivering them. Each model&apos;s <strong>max cohort enrollment capacity</strong> is
          the gating criterion — if the pipeline math needs more seats than a cohort can hold, the box flags it.
        </p>
        <div className={`grid gap-4 ${targetsFor ? "lg:grid-cols-[minmax(200px,240px)_1fr_minmax(320px,380px)]" : "lg:grid-cols-[minmax(220px,280px)_1fr]"}`}>
          {/* Delivery-model cards (drag sources) */}
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Delivery models</div>
            {models.map((m) => {
              const used = allocs.some((a) => a.programId === m.programId);
              return (
                <div key={m.programId}
                  draggable={!used}
                  onDragStart={(e) => e.dataTransfer.setData("text/rosie-program", m.programId)}
                  className={`rounded-lg border p-2.5 text-xs ${used ? "border-slate-100 bg-slate-50 text-slate-300" : "cursor-grab border-slate-200 bg-white hover:border-rose-300"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-medium ${used ? "" : "text-slate-800"}`}>{m.name}</span>
                    {!used && <button onClick={() => addAlloc(m.programId)} className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 hover:bg-rose-100">+ add</button>}
                  </div>
                  <div className={`mt-0.5 ${used ? "" : "text-slate-500"}`}>
                    {m.credential ?? "—"} · {m.terms}-term structure · {m.running} running
                  </div>
                  <div className={`mt-0.5 font-medium ${used ? "" : "text-slate-600"}`}>
                    max cohort enrollment: <span className="tabular-nums">{m.maxCapacity != null ? Math.round(m.maxCapacity) : "not set"}</span>
                  </div>
                  {used && <div className="mt-0.5 text-[10px]">in the plan below</div>}
                </div>
              );
            })}
            {models.length === 0 && <p className="text-[11px] text-slate-300">No delivery models yet — create one on the design page.</p>}
          </div>

          {/* Drop zone: the instantiation plan */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const id = e.dataTransfer.getData("text/rosie-program"); if (id) addAlloc(id); }}
            className={`rounded-xl border-2 border-dashed p-3 transition-colors ${dragOver ? "border-rose-400 bg-rose-50/50" : "border-slate-200 bg-slate-50/40"}`}>
            {allocs.length === 0 ? (
              <div className="flex h-full min-h-[120px] items-center justify-center text-center text-xs text-slate-400">
                Drop delivery models here — the instantiations responsible for delivering the {s.selectedYear} goal.
              </div>
            ) : (
              <div className="space-y-3">
                {allocs.map((a, ai) => {
                  const m = models.find((x) => x.programId === a.programId);
                  if (!m) return null;
                  const t = deriveCohortTargets(a.goal, s.goal, Math.max(1, m.terms));
                  const capNeeded = Math.round(t.capacity);
                  const nOfferings = m.maxCapacity != null && m.maxCapacity > 0 ? Math.max(1, Math.ceil(capNeeded / m.maxCapacity)) : 1;
                  const slots = slotsFor(a, nOfferings);
                  const lockedCount = slots.filter((o) => o.locked).length;
                  const setCount = (next: number) =>
                    setAllocs(allocs.map((x, i) => (i === ai ? { ...x, offerings: slots, offeringCount: Math.max(1, lockedCount, next), startDate: undefined, locked: undefined, cohortId: undefined, cohortName: undefined } : x)));
                  const removeSlot = (oi: number) => {
                    if (slots[oi]?.locked) return;
                    const next = slots.filter((_, j) => j !== oi);
                    setAllocs(allocs.map((x, i) => (i === ai ? { ...x, offerings: next, offeringCount: Math.max(1, next.length), startDate: undefined, locked: undefined, cohortId: undefined, cohortName: undefined } : x)));
                  };
                  const seatsEach = Math.ceil(capNeeded / Math.max(1, slots.length));
                  const goalShare = a.goal / Math.max(1, slots.length);
                  const anyUnlocked = slots.some((o) => !o.locked);
                  const allLocked = slots.length > 0 && slots.every((o) => o.locked);
                  const share = yearGoal > 0 ? Math.round((a.goal / yearGoal) * 100) : 0;
                  const setSlot = (oi: number, patch: Partial<OfferingSlot>) =>
                    setAllocs(allocs.map((x, i) => (i === ai ? { ...x, offerings: slots.map((o, j) => (j === oi ? { ...o, ...patch } : o)), startDate: undefined, locked: undefined, cohortId: undefined, cohortName: undefined } : x)));
                  const setGoal = (v: number) => setAllocs(allocs.map((x, i) => (i === ai ? { ...x, goal: Math.max(0, v) } : x)));
                  const setTermOverride = (ti: number, v: number | null) => setAllocs(allocs.map((x, i) => {
                    if (i !== ai) return x;
                    const o = [...(x.termOverrides ?? Array(m.terms).fill(null))];
                    o[ti] = v;
                    return { ...x, termOverrides: o };
                  }));
                  return (
                    <div key={a.programId} className={`rounded-lg border bg-white p-3 ${allLocked ? "border-emerald-200" : "border-slate-200"}`}>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-sm font-semibold text-slate-800">{m.name}</span>
                        <span className="text-[11px] text-slate-400">{m.credential ?? ""} · {m.terms} terms</span>
                        <span className="ml-auto flex items-center gap-2 text-xs">
                          <label className="flex items-center gap-1">
                            <span className="text-slate-500">covers</span>
                            <input type="number" min={0} value={a.goal} disabled={allLocked} onChange={(e) => setGoal(Number(e.target.value) || 0)} className="w-16 rounded border border-slate-200 px-1.5 py-1 text-right font-semibold tabular-nums focus:border-rose-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400" />
                            <span className="text-slate-500">productive ({share}%)</span>
                          </label>
                          {anyUnlocked && !slots.some((o) => o.locked) && <button onClick={() => setAllocs(allocs.filter((_, i) => i !== ai))} className="text-slate-300 hover:text-rose-600" title="remove">✕</button>}
                        </span>
                      </div>
                      {/* Capacity → how many offerings — suggested, but YOURS to add / subtract */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] tabular-nums">
                        <span className="text-slate-500">needs enrollment capacity <strong className="text-slate-700">{capNeeded}</strong></span>
                        <span className="text-slate-500">max cohort capacity <strong className="text-slate-700">{m.maxCapacity != null ? Math.round(m.maxCapacity) : "—"}</strong></span>
                        {slots.length > 1 ? (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-700">
                            {slots.length} offerings of this model ({seatsEach} seats each)
                          </span>
                        ) : (
                          m.maxCapacity != null && seatsEach <= (m.maxCapacity ?? Infinity) && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">fits in one offering</span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <button onClick={() => setCount(slots.length - 1)} disabled={slots.length <= Math.max(1, lockedCount)} className="rounded border border-slate-300 px-1.5 py-0.5 font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300" title={lockedCount > 0 && slots.length <= lockedCount ? "unlock an offering first" : "remove an offering"}>− offering</button>
                          <button onClick={() => setCount(slots.length + 1)} className="rounded border border-slate-300 px-1.5 py-0.5 font-semibold text-slate-600 hover:bg-slate-50" title="add another offering — split the same goal across more runs">+ offering</button>
                        </span>
                        {slots.length !== nOfferings && (
                          <span className="text-slate-400">math suggests {nOfferings} — your call</span>
                        )}
                        {m.maxCapacity != null && m.maxCapacity > 0 && seatsEach > m.maxCapacity && (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700">
                            ⚠ {seatsEach} seats each exceeds the model&apos;s max cohort of {Math.round(m.maxCapacity)} — add offerings or shrink this model&apos;s share
                          </span>
                        )}
                      </div>

                      {/* The offerings — adjust each start date so intakes line up, then lock each in */}
                      <div className="mt-2 space-y-1.5">
                        {slots.map((o, oi) => (
                          <div key={oi} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-slate-50/70 px-2.5 py-1.5 text-xs">
                            <span className="w-16 shrink-0 font-semibold text-slate-500">Offering {slots.length > 1 ? oi + 1 : ""}</span>
                            {o.locked ? (
                              <>
                                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-medium text-emerald-700">🔒 {o.cohortName ?? "Locked in"}</span>
                                <span className="tabular-nums text-slate-500">starts {fmtMY(o.startDate ?? null)} · ends ~{fmtMY(stopDateOf(o.startDate, m))}</span>
                                {o.cohortId && <Link href={`/programs/${m.programId}/offerings/${o.cohortId}`} className="font-medium text-rose-700 hover:underline">open the offering ↦</Link>}
                                {o.cohortId && (
                                  <button onClick={() => setTargetsFor(targetsFor === o.cohortId ? null : o.cohortId!)} className={`rounded-lg border px-2.5 py-1 font-medium ${targetsFor === o.cohortId ? "border-rose-400 bg-rose-600 text-white" : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"}`} title="set this offering's own talent-pipeline targets (side panel)">⚙ pipeline targets</button>
                                )}
                                <button
                                  onClick={() => unlock(ai, oi, slots)}
                                  disabled={unlockingId != null}
                                  className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                  title="undo the lock-in — deletes the instantiation (students are detached, not deleted) and frees this slot"
                                >{unlockingId === `${a.programId}:${oi}` ? "Unlocking…" : "🔓 Unlock"}</button>
                              </>
                            ) : (
                              <>
                                <label className="flex items-center gap-1.5">
                                  <span className="text-slate-500">starts</span>
                                  <input type="date" value={o.startDate ?? ""} onChange={(e) => setSlot(oi, { startDate: e.target.value || null })} className="rounded border border-slate-200 px-1.5 py-1 focus:border-rose-400 focus:outline-none" />
                                </label>
                                <span className="tabular-nums text-slate-500">ends ~{fmtMY(stopDateOf(o.startDate, m))}</span>
                                <span className="tabular-nums text-slate-400">≈ {seatsEach} seats · covers {Math.round(goalShare * 10) / 10} productive</span>
                                <button
                                  onClick={() => lockIn(ai, oi, goalShare, slots)}
                                  disabled={!o.startDate || a.goal <= 0 || lockingId != null}
                                  className="rounded-lg bg-rose-600 px-3 py-1 font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                                  title={!o.startDate ? "set a start date first" : a.goal <= 0 ? "give it a share of the goal first" : "create the real instantiation"}
                                >{lockingId === `${a.programId}:${oi}` ? "Locking in…" : "🔒 Lock in"}</button>
                                {slots.length > 1 && (
                                  <button onClick={() => removeSlot(oi)} className="text-slate-300 hover:text-rose-600" title="remove this offering slot">✕</button>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                        <p className="text-[10px] text-slate-400">
                          {slots.length > 1 ? "Adjust each offering's start so intakes line up (parallel sections, staggered Fall/Spring starts — your call), then lock each one in. " : ""}
                          Locking in creates the offering with real term dates and its share of the pipeline targets; Unlock undoes it.
                          Use ± offering to run more (or fewer) cohorts than the math suggests and sequence them to add up to the goal.
                        </p>
                      </div>

                      {/* Per-instantiation pipeline targets, respecting THIS model's term count */}
                      <div className="mt-2 overflow-x-auto">
                        <table className="min-w-full text-[11px]">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                              <th className="py-1 pr-3 font-medium">Interested</th><th className="py-1 pr-3 font-medium">Qualified</th><th className="py-1 pr-3 font-medium">Offered</th>
                              {t.terms.map((_, i) => <th key={i} className="py-1 pr-3 font-medium text-rose-500">T{i + 1} enrolled</th>)}
                              <th className="py-1 pr-3 font-medium">Completing</th><th className="py-1 pr-3 font-medium">Licensed</th><th className="py-1 pr-3 font-medium">Placed</th><th className="py-1 pr-0 font-medium">Productive</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="tabular-nums text-slate-700">
                              <td className="py-1 pr-3">{Math.round(t.interested)}</td>
                              <td className="py-1 pr-3">{Math.round(t.qualified)}</td>
                              <td className="py-1 pr-3">{Math.round(t.offered)}</td>
                              {t.terms.map((tv, i) => {
                                const ov = a.termOverrides?.[i] ?? null;
                                return (
                                  <td key={i} className="py-1 pr-3">
                                    <input
                                      type="number" min={0}
                                      value={ov ?? Math.round(tv)}
                                      disabled={allLocked}
                                      onChange={(e) => setTermOverride(i, e.target.value === "" ? null : Number(e.target.value))}
                                      className={`w-14 rounded border px-1 py-0.5 text-right ${ov != null ? "border-rose-300 bg-rose-50 font-semibold text-rose-800" : "border-slate-200 text-slate-700"}`}
                                      title={ov != null ? "override — clear to return to the derived figure" : "derived from the goal; type to override this term's enrollment"}
                                    />
                                  </td>
                                );
                              })}
                              <td className="py-1 pr-3">{Math.round(t.completing)}</td>
                              <td className="py-1 pr-3">{Math.round(t.licensed)}</td>
                              <td className="py-1 pr-3">{Math.round(t.placed)}</td>
                              <td className="py-1 pr-0 font-semibold">{Math.round(t.productive)}</td>
                            </tr>
                          </tbody>
                        </table>
                        <p className="mt-0.5 text-[10px] text-slate-400">Targets derived backward from this instantiation&apos;s {a.goal}-productive goal through the family&apos;s health rates, across its {m.terms} terms. Type in a term cell to override enrollment for that term.</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Side-by-side: THIS offering's own talent-pipeline targets */}
          {targetsFor && (() => {
            const inst = allInsts.find((x) => x.id === targetsFor);
            if (!inst) return null;
            return (
              <OfferingTargetsPanel
                key={inst.id}
                inst={inst}
                defaultRates={s.goal}
                onClose={() => setTargetsFor(null)}
                onSaved={() => router.refresh()}
              />
            );
          })()}
        </div>
      </div>

      {/* Family DEFAULT health rates — what new offerings start from; each offering overrides its own */}
      <details className="rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">
          Default health rates for new offerings <span className="font-normal text-slate-400">— every locked-in offering can set its own (⚙ pipeline targets); these are the starting point</span>
          <button onClick={(e) => { e.preventDefault(); resetBenchmark(); }} className="ml-3 rounded-lg border border-slate-300 px-2 py-0.5 text-[11px] font-normal text-slate-500 hover:bg-slate-50">Reset to benchmark</button>
        </summary>
      <div className="border-t border-slate-100 p-4">
      {/* Selected year's full pipeline — two tables */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">{s.selectedYear} pipeline plan <span className="font-normal text-slate-400">— goal rates set the plan; actuals are sourced live from the student database</span></h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <div className="text-sm font-semibold text-slate-700">Talent-pipeline health metrics</div>
              <p className="text-[11px] text-slate-400">Goal % is editable. <strong>Actual % is live from the student database{hasActual ? "" : s.selectedYear > nowYear ? ` — ${s.selectedYear} hasn't started` : ` — no student records for ${s.selectedYear}`}.</strong></p>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 text-left font-medium">Metric</th>
                  <th className="px-2 py-2 text-right font-medium">Goal</th>
                  <th className="px-2 py-2 text-right font-medium">Actual</th>
                  <th className="px-3 py-2 text-right font-medium">Bench</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {RATE_DEFS.map((d) => {
                  const gv = s.goal[d.key];
                  const ar = af ? actualRateOf(d.key, af, goalCapacity) : null;
                  const healthy = ar != null && ar >= d.benchmark;
                  return (
                    <tr key={d.key} className="hover:bg-slate-50/60">
                      <td className="px-4 py-1.5">
                        <span className="block font-medium text-slate-700">{d.label}</span>
                        <span className="block text-[10px] text-slate-400">{d.of}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input type="number" value={Math.round(gv * 1000) / 10} step={1} onChange={(e) => setGoalRate(d.key, Number(e.target.value) || 0)} className="w-16 rounded border border-slate-200 px-1.5 py-1 text-right tabular-nums focus:border-rose-400 focus:outline-none" /><span className="ml-0.5 text-slate-400">%</span>
                      </td>
                      <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${ar == null ? "text-slate-300" : healthy ? "text-emerald-600" : "text-amber-600"}`}>{ar == null ? "—" : pct(ar)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{pct(d.benchmark)}</td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-50/60">
                  <td className="px-4 py-1.5"><span className="block font-medium text-slate-700">Regional pipeline utilization</span><span className="block text-[10px] text-slate-400">productive ÷ enrollment capacity</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{pctOf(goalUtil)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${actualUtil != null && actualUtil >= UTILIZATION_BENCHMARK ? "text-emerald-600" : "text-amber-600"}`}>{pctOf(actualUtil)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{pct(UTILIZATION_BENCHMARK)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <div className="text-sm font-semibold text-slate-700">Talent-pipeline metrics — cohort ending {s.selectedYear}</div>
              <p className="text-[11px] text-slate-400">Autocalculated, in funnel order. Goal vs actual vs attainment.</p>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 text-left font-medium">Metric</th>
                  <th className="px-3 py-2 text-right font-medium">Goal</th>
                  <th className="px-3 py-2 text-right font-medium">Actual</th>
                  <th className="px-3 py-2 text-right font-medium">Attain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ladderRows.map((r) => {
                  const a = attain(r.g, r.a);
                  return (
                    <tr key={r.label} className={r.strong ? "bg-rose-50/40" : "hover:bg-slate-50/60"}>
                      <td className={`px-4 py-1.5 ${r.strong ? "font-semibold text-slate-800" : "text-slate-700"}`}>{r.label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{num(r.g)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${r.a == null ? "text-slate-300" : r.strong ? "font-semibold text-slate-900" : "text-slate-700"}`}>{r.a == null ? "—" : num(r.a)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${attainColor(a)}`}>{pctOf(a)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      </div>
      </details>
    </div>
  );
}

// ───────── Cohort-specific talent-pipeline targets (side panel) ─────────
function OfferingTargetsPanel({ inst, defaultRates, onClose, onSaved }: {
  inst: Instantiation; defaultRates: LadderRates; onClose: () => void; onSaved: () => void;
}) {
  const saved = (() => {
    try { return inst.pipelineRates ? JSON.parse(inst.pipelineRates) as { goal?: number; rates?: Partial<LadderRates>; termOverrides?: (number | null)[] } : null; } catch { return null; }
  })();
  const [goal, setGoal] = useState<number>(saved?.goal ?? inst.goalProductive ?? 0);
  const [rates, setRates] = useState<LadderRates>({ ...defaultRates, ...(saved?.rates ?? {}) });
  const [termOverrides, setTermOverrides] = useState<(number | null)[]>(saved?.termOverrides ?? []);
  const [busy, setBusy] = useState(false);
  const terms = Math.max(1, inst.terms ?? 1);
  const t = deriveCohortTargets(Math.max(0, goal), rates, terms);
  const save = async () => {
    setBusy(true);
    try { await saveCohortPipeline(inst.id, { goal, rates: { ...rates } as unknown as Record<string, number>, termOverrides }); onSaved(); } finally { setBusy(false); }
  };
  const inp = "w-16 rounded border border-slate-200 px-1.5 py-0.5 text-right tabular-nums focus:border-rose-400 focus:outline-none";
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/30 p-3 text-xs">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-800">{inst.name} — pipeline targets</div>
          <div className="text-[11px] text-slate-500">{inst.program} · cohort-specific: these rates and this goal belong to THIS offering only</div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
      </div>
      <label className="mb-2 flex items-center gap-2">
        <span className="font-medium text-slate-700">Goal — fully productive placements</span>
        <input type="number" min={0} value={goal} onChange={(e) => setGoal(Number(e.target.value) || 0)} className={`${inp} w-20 text-base font-semibold`} />
      </label>
      <table className="w-full">
        <thead><tr className="text-left text-[10px] uppercase tracking-wide text-slate-400"><th className="py-1">Health metric</th><th className="py-1 text-right">Goal %</th><th className="py-1 text-right">Bench</th></tr></thead>
        <tbody className="divide-y divide-rose-100">
          {RATE_DEFS.map((d) => (
            <tr key={d.key}>
              <td className="py-1 pr-2"><span className="block font-medium text-slate-700">{d.label}</span><span className="block text-[10px] text-slate-400">{d.of}</span></td>
              <td className="py-1 text-right"><input type="number" step={1} value={Math.round(rates[d.key] * 1000) / 10} onChange={(e) => setRates((r) => ({ ...r, [d.key]: (Number(e.target.value) || 0) / 100 }))} className={inp} />%</td>
              <td className="py-1 text-right tabular-nums text-slate-400">{Math.round(d.benchmark * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 rounded-lg bg-white p-2 ring-1 ring-rose-100">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Derived targets — funnel order</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums text-slate-700">
          <span>Interested</span><span className="text-right font-medium">{Math.round(t.interested)}</span>
          <span>Qualified</span><span className="text-right font-medium">{Math.round(t.qualified)}</span>
          <span>Offered</span><span className="text-right font-medium">{Math.round(t.offered)}</span>
          {t.terms.map((tv, i) => (
            <span key={i} className="contents">
              <span className="text-rose-700">Enrolled — Term {i + 1}</span>
              <span className="text-right">
                <input type="number" min={0} value={termOverrides[i] ?? Math.round(tv)} onChange={(e) => setTermOverrides((o) => { const n = [...o]; n[i] = e.target.value === "" ? null : Number(e.target.value); return n; })} className={`${inp} ${termOverrides[i] != null ? "border-rose-300 bg-rose-50 font-semibold text-rose-800" : ""}`} title="derived from the goal; type to override this term" />
              </span>
            </span>
          ))}
          <span>Completing</span><span className="text-right font-medium">{Math.round(t.completing)}</span>
          <span>Licensed</span><span className="text-right font-medium">{Math.round(t.licensed)}</span>
          <span>Placed</span><span className="text-right font-medium">{Math.round(t.placed)}</span>
          <span className="font-semibold text-slate-900">Productive</span><span className="text-right font-semibold text-slate-900">{Math.round(t.productive)}</span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={save} disabled={busy} className="rounded-lg bg-rose-600 px-3 py-1.5 font-medium text-white hover:bg-rose-700 disabled:opacity-50">{busy ? "Saving…" : "Save to this offering"}</button>
        <button onClick={() => { setRates({ ...defaultRates }); setTermOverrides([]); }} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-500 hover:bg-white">Use family defaults</button>
      </div>
    </div>
  );
}
