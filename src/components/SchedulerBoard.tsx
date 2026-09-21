"use client";
import { driveBandLabel, driveBandPhrase, DEFAULT_BANDS } from "@/lib/geo";

// The clinical scheduler board — supply vs demand, the recommended plan, and
// the analytics layers around it. Reads like a briefing: one sentence, then
// six numbers, then the balance by setting, the week × setting heat map, the
// sites, the ranked bottlenecks (each with what would fix it), and finally the
// plan itself — by shift, and by student. The levers on top re-run everything.

import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_POLICY, AUTO_PLAN_NOTE, REASON_LABEL, type Policy, type Plan, type Preceptor, type Instructor, type StudentLite, type FamilyAgreement, type Assignment, type SiteCapacityLite, type ConfirmedSetting } from "@/lib/scheduler";
import { schedulerModel, filterDemand, planFor } from "@/lib/schedulerplan";
import type { AssetLite, AssetDayOverride, AssetBookingLite } from "@/lib/assetmap";
import type { CapacityCohort } from "@/components/CapacityBoard";
import type { RotationCodeRow } from "@/components/AssetMapBoard";
import { applySchedulerLevers, clearSchedulerPlan, previewSchedulerApply, undoChangeSet, type SchedulerPreview } from "@/lib/actions";
import { SchedulerCapacity } from "@/components/SchedulerCapacity";
import type { ChangeSetRow } from "@/lib/changesets";
import { ChangeHistory } from "@/components/ChangeHistory";
import { dec, fmt } from "@/lib/format";

const n0 = (v: number) => dec(v);
const signed = (v: number) => (v > 0 ? `+${dec(v)}` : v < 0 ? `−${dec(Math.abs(v))}` : "0");
const times = (v: number | null) => (v == null ? "—" : `${fmt.mult(v)}×`);
const pct = (v: number) => fmt.pct(v);
const fmtD = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const fmtW = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const AGREEMENT: Record<string, string> = { none: "bg-slate-100 text-slate-500", prospect: "bg-sky-100 text-sky-700", asked: "bg-amber-100 text-amber-700", secured: "bg-emerald-100 text-emerald-700", declined: "bg-rose-100 text-rose-700" };
const VERDICT: Record<string, string> = { fits: "bg-emerald-100 text-emerald-800", tight: "bg-amber-100 text-amber-800", short: "bg-rose-100 text-rose-800", none: "bg-slate-100 text-slate-500" };
const VERDICT_LABEL: Record<string, string> = { fits: "fits", tight: "tight", short: "short", none: "no demand" };
type Tab = "overview" | "bottlenecks" | "sites" | "plan" | "students" | "preceptors";
const numOrNull = (v: string) => (v === "" ? null : Number(v));
/** The variety levers as one choice: how much breadth the plan works for per student. */
const VARIETY: { key: string; label: string; set: Pick<Policy, "varietySites" | "varietyFacilityTypes" | "varietySystems"> }[] = [
  { key: "none", label: "no preference", set: { varietySites: false, varietyFacilityTypes: false, varietySystems: false } },
  { key: "sites", label: "new sites", set: { varietySites: true, varietyFacilityTypes: false, varietySystems: false } },
  { key: "types", label: "new sites + facility types", set: { varietySites: true, varietyFacilityTypes: true, varietySystems: false } },
  { key: "all", label: "new sites + types + health systems", set: { varietySites: true, varietyFacilityTypes: true, varietySystems: true } },
];
const varietyKey = (p: Policy) => (p.varietySystems ? "all" : p.varietyFacilityTypes ? "types" : p.varietySites ? "sites" : "none");
const min = (v: number | null) => fmt.minutes(v);
/** Lever names for the "this lever changed nothing" note. */
const LEVER_NAMES: Record<keyof Policy, string> = {
  agreements: "Sites that count", flexibleShift: "Shift", flexibleDays: "Day", maxRing: "Drive time", continuity: "Continuity", spread: "Balance", requirePreceptor: "Preceptors", skipHolidays: "Holidays", split: "Split sections",
  maxStudentDriveMin: "Drive cap from home", preferCloserToStudent: "Nearer home", rotateSitesEveryWeeks: "Rotate sites", varietySites: "Variety", varietyFacilityTypes: "Variety", varietySystems: "Variety",
  preceptorStint: "Keep the same preceptor", varietyPreceptors: "New preceptors", maxPreceptorShiftsPerWeek: "Weekly ceiling", studentsPerPreceptor: "Students per preceptor",
};
const sigOf = (p: Plan) => `${p.summary.placedSeats}|${p.summary.readiness.ready}|${p.summary.unmetShifts}|${p.assignments.length}|${p.blockers.map((b) => `${b.kind}:${b.seats}`).join(",")}`;

export function SchedulerBoard({ institutionId, cohorts, assets, overrides, bookings, rotations, preceptors, instructors, students, familyAgreements, siteCaps, confirmedSettings, changes, from, to, canApply = true }: {
  institutionId: string; cohorts: CapacityCohort[]; assets: AssetLite[]; overrides: AssetDayOverride[]; bookings: (AssetBookingLite & { note?: string | null })[]; rotations: RotationCodeRow[];
  preceptors: Preceptor[]; instructors: Instructor[]; students: StudentLite[]; familyAgreements: FamilyAgreement[]; siteCaps: SiteCapacityLite[]; confirmedSettings: ConfirmedSetting[]; changes: ChangeSetRow[]; from: string; to: string;
  /** Phase 13: the strategic product reads the plan and never writes it; apply, undo and clear are shown only in the operational module. */
  canApply?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [tab, setTab] = useState<Tab>("bottlenecks");
  const [cohortFilter, setCohortFilter] = useState<Set<string>>(new Set());
  const [window, setWindow] = useState<{ from: string; to: string }>({ from, to });
  const [planFilter, setPlanFilter] = useState<{ site: string; setting: string; cohort: string; q: string }>({ site: "", setting: "", cohort: "", q: "" });
  const [applied, setApplied] = useState<{ bookings: number; placements: number; meetings: number; sections: number; moves: number; staffed: number; shifts: number; offSite: number; changeSetId: string | null } | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState<string | null>(null);
  // Phase 5: preview → confirm (blockers gate the confirm; an override is recorded) → undo.
  const [preview, setPreview] = useState<SchedulerPreview | null>(null);
  const [override, setOverride] = useState(false);
  const [noChange, setNoChange] = useState<string | null>(null);
  // Phase 8: the plan is built in the browser only. Rendering it on the server spent ~5 s per request
  // before a byte reached the reader; now the page paints at once and says it is building the plan.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const [showLevers, setShowLevers] = useState(false); // the six levers that decide what can be placed are always in view; the rest fold

  // Demand → plan, by the same steps the apply action runs on the server (lib/schedulerplan),
  // so what is on screen is what gets written.
  const model = useMemo(() => schedulerModel(cohorts, rotations), [cohorts, rotations]);
  const demandAll = model.demand;
  const levers = useMemo(() => ({ policy, from: window.from, to: window.to, cohortIds: [...cohortFilter] }), [policy, window, cohortFilter]);
  const demand = useMemo(() => filterDemand(demandAll, levers), [demandAll, levers]);
  const supply = useMemo(() => ({ assets, overrides, bookings, rotations, preceptors, instructors, students, familyAgreements, siteCaps, confirmedSettings }), [assets, overrides, bookings, rotations, preceptors, instructors, students, familyAgreements, siteCaps, confirmedSettings]);
  const manualBookings = useMemo(() => bookings.filter((b) => b.note !== AUTO_PLAN_NOTE), [bookings]);
  const autoBookings = useMemo(() => bookings.filter((b) => b.note === AUTO_PLAN_NOTE), [bookings]);

  // The plan is rebuilt in the browser on every lever change. The levers the plan was last built
  // under are deferred, so the page can say "recomputing…" (and keep the old numbers visibly
  // stale) while the new plan is built, instead of freezing with the old numbers.
  const builtLevers = useDeferredValue(levers);
  const builtDemand = useMemo(() => (hydrated ? filterDemand(demandAll, builtLevers) : []), [demandAll, builtLevers, hydrated]);
  const plan: Plan = useMemo(() => planFor(builtDemand, supply, builtLevers.policy, model.campus, model.holidays), [builtDemand, supply, builtLevers.policy, model.campus, model.holidays]);
  const recomputing = builtLevers !== levers;
  const computing = !hydrated || recomputing;
  const s = plan.summary;
  const rd = s.readiness;
  const blocking = plan.blockers.filter((b) => b.blocking);
  // A lever that changes nothing says so, instead of leaving the room to guess.
  const prevRef = useRef<{ policy: Policy; sig: string } | null>(null);
  useEffect(() => {
    const sig = sigOf(plan);
    const prev = prevRef.current;
    if (prev && prev.policy !== builtLevers.policy) {
      const changed = [...new Set((Object.keys(builtLevers.policy) as (keyof Policy)[]).filter((k) => prev.policy[k] !== builtLevers.policy[k]).map((k) => LEVER_NAMES[k]))];
      if (changed.length && sig === prev.sig) setNoChange(`Changing ${changed.join(" and ")} did not change the plan — the same ${n0(plan.summary.placedSeats)} learner-shifts placed, ${n0(plan.summary.readiness.ready)} ready. This lever has no bearing on what binds here${plan.bottlenecks[0] ? `; the biggest bottleneck is that ${REASON_LABEL[plan.bottlenecks[0].reason].split(" — ")[0]}` : ""}.`);
      else if (changed.length) setNoChange(null);
    } else if (prev && sig !== prev.sig) setNoChange(null);
    prevRef.current = { policy: builtLevers.policy, sig };
  }, [plan, builtLevers.policy]);
  useEffect(() => { setPreview(null); setOverride(false); }, [levers]);
  const settingName = (code: string) => plan.balance.find((b) => b.settingCode === code)?.setting ?? code;
  const weekMondays = useMemo(() => [...new Set(plan.weeks.map((w) => w.weekMonday))].sort(), [plan]);
  const settingCodes = useMemo(() => plan.balance.filter((b) => b.demandShifts > 0).map((b) => b.settingCode), [plan]);
  const cohortsInDemand = useMemo(() => [...new Set(demandAll.map((u) => `${u.cohortId}|${u.cohort} · ${u.program}`))].map((x) => { const [id, label] = x.split("|"); return { id, label }; }), [demandAll]);
  const sitesInPlan = useMemo(() => [...new Set(plan.assignments.map((x) => x.siteName))].sort(), [plan]);
  const filteredPlan = useMemo(() => plan.assignments.filter((x) => (!planFilter.site || x.siteName === planFilter.site) && (!planFilter.setting || x.unit.settingCode === planFilter.setting) && (!planFilter.cohort || x.unit.cohortId === planFilter.cohort) && (!planFilter.q || `${x.unit.courseCode} ${x.unit.courseTitle} ${x.preceptorNames.join(" ")} ${x.instructorName ?? ""} ${x.asset.externalId ?? ""}`.toLowerCase().includes(planFilter.q.toLowerCase()))), [plan, planFilter]);
  const cohortIdsInPlan = useMemo(() => [...new Set(plan.assignments.map((x) => x.unit.cohortId))], [plan]);

  // Apply sends the LEVERS, not the plan: the server rebuilds the same plan, previews what it would
  // write, and writes it only on confirm — refusing while a blocking blocker stands, unless overridden.
  const doPreview = () => startTransition(async () => {
    setApplyError(null); setApplied(null);
    try { setPreview(await previewSchedulerApply(institutionId, levers)); }
    catch (e) { setApplyError(e instanceof Error ? e.message : String(e)); }
  });
  const confirmApply = () => startTransition(async () => {
    setApplyError(null);
    try { const r = await applySchedulerLevers(institutionId, levers, { override: override ? blocking.map((b) => b.kind) : [] }); setApplied(r); setPreview(null); setOverride(false); router.refresh(); }
    catch (e) { setApplyError(e instanceof Error ? e.message : String(e)); }
  });
  const undo = (id: string) => startTransition(async () => {
    setApplyError(null);
    try { await undoChangeSet(id); setApplied(null); router.refresh(); }
    catch (e) { setApplyError(e instanceof Error ? e.message : String(e)); }
  });
  const clear = () => startTransition(async () => {
    setApplyError(null);
    try { await clearSchedulerPlan(cohortIdsInPlan.length ? cohortIdsInPlan : [...new Set(autoBookings.map((b) => b.cohortId))]); setApplied(null); router.refresh(); }
    catch (e) { setApplyError(e instanceof Error ? e.message : String(e)); }
  });

  const Lever = ({ label, children, hint }: { label: string; children: React.ReactNode; hint: string }) => (
    <label className="block rounded-lg border border-slate-200 bg-white px-2.5 py-1.5" title={hint}>
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
  const sel = "mt-0.5 w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs";

  return (
    <section className="space-y-4">
      {/* ── Levers — on top, always in view: the rules the plan is built under. Everything below recomputes. ── */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-800">Levers <span className="font-normal text-slate-500">— {policy.agreements === "secured" ? "secured sites" : policy.agreements === "secured+asked" ? "secured + asked sites" : "any partner"} · {policy.maxRing === "any" ? "any drive time" : driveBandPhrase(policy.maxRing) ?? policy.maxRing} · {policy.flexibleShift ? "any shift" : "exact shift"} · {policy.flexibleDays ? `± ${policy.flexibleDays} day${policy.flexibleDays === 1 ? "" : "s"}` : "exact date"} · {policy.requirePreceptor ? "preceptor required" : "seats only"} · {cohortFilter.size === 0 ? `all ${cohortsInDemand.length} offerings` : `${cohortFilter.size} of ${cohortsInDemand.length} offerings`}</span></div>
          <div className="flex items-center gap-3 text-xs">
            {computing && <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-amber-800"><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />{hydrated ? "recomputing…" : `building the plan for ${n0(demand.length)} shifts…`}</span>}
            <button onClick={() => setPolicy(DEFAULT_POLICY)} className="text-slate-500 hover:text-rose-700">reset</button>
            <button type="button" onClick={() => setShowLevers((v) => !v)} aria-expanded={showLevers} className="rounded-full bg-white px-2.5 py-0.5 font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100">{showLevers ? "fewer levers" : "all levers"}</button>
          </div>
        </div>
        {noChange && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">{noChange}</p>}
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Lever label="Sites that count" hint="Which partner agreements may host learners. A program family's own agreement with a site wins over the institution-level one; an agreement that has ended does not count after its end date.">
            <select value={policy.agreements} onChange={(e) => setPolicy({ ...policy, agreements: e.target.value as Policy["agreements"] })} className={sel}><option value="secured">secured only</option><option value="secured+asked">secured + asked</option><option value="any">any partner with the asset</option></select>
          </Lever>
          <Lever label="Drive time" hint="Farthest a site may be from the main campus, by its drive-time band.">
            <select value={policy.maxRing} onChange={(e) => setPolicy({ ...policy, maxRing: e.target.value as Policy["maxRing"] })} className={sel}><option value="Core">{driveBandPhrase("Core")}</option><option value="Ring 1">{`within ${DEFAULT_BANDS.oneMinutes} min drive`}</option><option value="Ring 2">{`within ${DEFAULT_BANDS.twoMinutes} min drive`}</option><option value="any">any drive time</option></select>
          </Lever>
          <Lever label="Shift" hint="May a clinical shift land on a different shift block (day / evening / night) than its session says?">
            <select value={String(policy.flexibleShift)} onChange={(e) => setPolicy({ ...policy, flexibleShift: e.target.value === "true" })} className={sel}><option value="false">exact shift only</option><option value="true">any shift the asset runs</option></select>
          </Lever>
          <Lever label="Day" hint="May a clinical shift move inside its week to a day the asset is open? A shift on a holiday moves off it this way too.">
            <select value={String(policy.flexibleDays)} onChange={(e) => setPolicy({ ...policy, flexibleDays: Number(e.target.value) as Policy["flexibleDays"] })} className={sel}><option value="0">exact date</option><option value="1">± 1 day in the week</option><option value="2">± 2 days in the week</option></select>
          </Lever>
          <Lever label="Preceptors" hint="Only place a clinical shift where a free preceptor person exists at that site on that shift block.">
            <select value={String(policy.requirePreceptor)} onChange={(e) => setPolicy({ ...policy, requirePreceptor: e.target.value === "true" })} className={sel}><option value="false">count seats only</option><option value="true">require a free preceptor</option></select>
          </Lever>
          <Lever label="Holidays" hint="A shift on an observed holiday is left for moving (or moved by the Day lever), or placed anyway — a blocker until moved.">
            <select value={String(policy.skipHolidays)} onChange={(e) => setPolicy({ ...policy, skipHolidays: e.target.value === "true" })} className={sel}><option value="true">never on a holiday</option><option value="false">place anyway</option></select>
          </Lever>
        </div>
        {showLevers && <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <Lever label="Drive cap from home" hint="Farthest a site may be from a student's home. Students whose home town is not on record are unaffected.">
              <select value={policy.maxStudentDriveMin ?? ""} onChange={(e) => setPolicy({ ...policy, maxStudentDriveMin: numOrNull(e.target.value) })} className={sel}><option value="">no cap</option>{[30, 45, 60, 75, 90].map((n) => <option key={n} value={n}>within {n} min</option>)}</select>
            </Lever>
            <Lever label="Students per preceptor" hint="How many students one preceptor may take on a shift. Default: whatever the session says it needs.">
              <select value={policy.studentsPerPreceptor ?? ""} onChange={(e) => setPolicy({ ...policy, studentsPerPreceptor: numOrNull(e.target.value) })} className={sel}><option value="">as the session says</option>{[1, 2, 3].map((n) => <option key={n} value={n}>{n === 1 ? "one to one" : `up to ${n} students`}</option>)}</select>
            </Lever>
            <Lever label="Weekly ceiling" hint="The most student shifts one preceptor takes in a week.">
              <select value={policy.maxPreceptorShiftsPerWeek ?? ""} onChange={(e) => setPolicy({ ...policy, maxPreceptorShiftsPerWeek: numOrNull(e.target.value) })} className={sel}><option value="">no ceiling</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} shift{n === 1 ? "" : "s"} a week</option>)}</select>
            </Lever>
            <Lever label="Continuity" hint="Keep a section at the same site for the whole course wherever possible.">
              <select value={String(policy.continuity)} onChange={(e) => setPolicy({ ...policy, continuity: e.target.value === "true" })} className={sel}><option value="true">keep each section at one site</option><option value="false">any site each shift</option></select>
            </Lever>
            <Lever label="Balance" hint="Prefer the least-loaded site over the closest / most secured one.">
              <select value={String(policy.spread)} onChange={(e) => setPolicy({ ...policy, spread: e.target.value === "true" })} className={sel}><option value="false">closest & most secured first</option><option value="true">spread load across sites</option></select>
            </Lever>
            <Lever label="Split sections" hint="When no single site can seat a whole section on one shift, may it split across sites? Preceptor-led sections can (students are 1:1 with a preceptor anyway); an instructor-led group travels together.">
              <select value={policy.split} onChange={(e) => setPolicy({ ...policy, split: e.target.value as Policy["split"] })} className={sel}><option value="preceptor-led">preceptor-led may split</option><option value="none">never split a section</option><option value="any">any section may split</option></select>
            </Lever>
            <Lever label="Nearer home" hint="Prefer sites nearer each student's home over sites nearer campus.">
              <select value={String(policy.preferCloserToStudent)} onChange={(e) => setPolicy({ ...policy, preferCloserToStudent: e.target.value === "true" })} className={sel}><option value="true">prefer sites near the student</option><option value="false">campus distance only</option></select>
            </Lever>
            <Lever label="Rotate sites" hint="With continuity on: how long a student stays at one site before the plan looks for a different one.">
              <select value={policy.rotateSitesEveryWeeks ?? ""} onChange={(e) => setPolicy({ ...policy, rotateSitesEveryWeeks: numOrNull(e.target.value) })} className={sel}><option value="">whole course at one site</option>{[2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>every {n} weeks</option>)}</select>
            </Lever>
            <Lever label="Variety" hint="What the plan works to give every student over the course: sites they haven't been to, kinds of facility they haven't seen (hospital, imaging center, clinic), health systems they haven't been in.">
              <select value={varietyKey(policy)} onChange={(e) => setPolicy({ ...policy, ...VARIETY.find((v) => v.key === e.target.value)!.set })} className={sel}>{VARIETY.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}</select>
            </Lever>
            <Lever label="Keep the same preceptor" hint="Shifts in a row a student keeps the same preceptor before rotating to another at the site. Evaluations need a stretch; variety needs a change.">
              <select value={policy.preceptorStint ?? ""} onChange={(e) => setPolicy({ ...policy, preceptorStint: numOrNull(e.target.value) })} className={sel}><option value="">as long as possible</option><option value="1">rotate every shift</option>{[2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>for {n} shifts, then rotate</option>)}</select>
            </Lever>
            <Lever label="New preceptors" hint="When several preceptors are free, prefer one the student has not had yet.">
              <select value={String(policy.varietyPreceptors)} onChange={(e) => setPolicy({ ...policy, varietyPreceptors: e.target.value === "true" })} className={sel}><option value="false">least-loaded first</option><option value="true">prefer one the student hasn't had</option></select>
            </Lever>
          </div>
        </>}
        <div className="mt-2 flex flex-wrap items-end gap-3 text-xs">
          <label className="block"><span className="block text-[10px] text-slate-400">From</span><input type="date" value={window.from} onChange={(e) => setWindow({ ...window, from: e.target.value || from })} className="rounded border border-slate-300 px-1.5 py-1" /></label>
          <label className="block"><span className="block text-[10px] text-slate-400">To</span><input type="date" value={window.to} onChange={(e) => setWindow({ ...window, to: e.target.value || to })} className="rounded border border-slate-300 px-1.5 py-1" /></label>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-slate-400">Offerings:</span>
            <button onClick={() => setCohortFilter(new Set())} className={`rounded-full px-2 py-0.5 ${cohortFilter.size === 0 ? "bg-slate-800 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>all {cohortsInDemand.length}</button>
            {cohortsInDemand.map((c) => <button key={c.id} onClick={() => setCohortFilter((f) => { const n = new Set(f); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} className={`rounded-full px-2 py-0.5 ${cohortFilter.has(c.id) ? "bg-rose-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>{c.label}</button>)}
          </div>
        </div>
      </div>

      {/* ── The answer: the share placed, the rings, and why not 100% ── */}
      <SchedulerCapacity plan={plan} policy={policy} window={window} computing={computing} mode={canApply ? "operational" : "diagnostic"} onShowBottlenecks={() => setTab("bottlenecks")} onOpenLevers={() => setShowLevers(true)} />

      {/* ── Apply flow (operational module only) ── */}
      {canApply && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {!preview && <button onClick={doPreview} disabled={pending || plan.assignments.length === 0} className="rounded-lg bg-rose-600 px-3 py-1.5 font-medium text-white hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400">{pending ? "Working…" : `Preview apply — ${n0(plan.assignments.length)} shifts`}</button>}
          {(autoBookings.length > 0 || applied) && <button onClick={clear} disabled={pending} className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50">Clear the applied plan</button>}
          {applied?.changeSetId && <button onClick={() => undo(applied.changeSetId!)} disabled={pending} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100">Undo this apply</button>}
          <span className="text-slate-500">
            {applyError ? <span className="text-rose-700">Could not apply: {applyError}</span> : applied ? <span className="text-emerald-700">Applied and recorded: {n0(applied.sections)} shifts as {n0(applied.bookings)} asset bookings · {n0(applied.moves)} shifts moved on the calendar · {n0(applied.staffed)} preceptor and instructor shift assignments · {n0(applied.shifts)} student shifts pinned · {n0(applied.placements)} student placements{applied.offSite ? ` · ${n0(applied.offSite)} preceptor assignments from other sites taken off shifts that now happen elsewhere` : ""}. <a href="/calendar" className="underline">See it on the calendar →</a></span> : autoBookings.length > 0 ? `${n0(autoBookings.length)} asset bookings from an earlier applied plan are on the books — they will be replaced.` : "Applying writes every shift to the calendar. Hand-made bookings, moves and assignments are never touched. Preview first; the change is recorded and can be undone."}
            {manualBookings.length > 0 && ` ${n0(manualBookings.length)} hand-made bookings already take seats.`}
          </span>
        </div>
        {preview && (
          <div className="mt-3 rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">What applying would write</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200"><div className="text-[10px] uppercase tracking-wide text-emerald-700">Created</div><ul className="mt-0.5 space-y-0.5 text-slate-700"><li>{n0(preview.bookings)} asset bookings for {n0(preview.sections)} shifts on {n0(preview.sitesUsed)} sites</li><li>{n0(preview.preceptorAssignments)} preceptor and {n0(preview.instructorAssignments)} instructor shift assignments</li><li>student placements and pinned shifts for {n0(preview.studentsPinned)} enrolled students</li></ul></div>
              <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200"><div className="text-[10px] uppercase tracking-wide text-amber-700">Changed</div><ul className="mt-0.5 space-y-0.5 text-slate-700"><li>each clinical section&apos;s meeting pattern → its main site and lead preceptor</li><li>{n0(preview.movedShifts)} shifts moved to another day or shift block on the calendar</li></ul></div>
              <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200"><div className="text-[10px] uppercase tracking-wide text-rose-700">Removed (replaced)</div><ul className="mt-0.5 space-y-0.5 text-slate-700"><li>{n0(preview.replacing.bookings)} earlier plan bookings · {n0(preview.replacing.moves)} moves · {n0(preview.replacing.staff)} staff rows · {n0(preview.replacing.placements)} placements</li><li>hand-made rows are never removed</li></ul></div>
            </div>
            <div className="mt-2 text-slate-600">Ready after apply: <strong>{n0(preview.readiness.ready)}</strong> of {n0(preview.demandSeats)} learner-shifts ({pct(preview.readiness.readyShare)}).</div>
            {preview.blockers.filter((b) => b.blocking).length > 0 && (
              <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2">
                <div className="font-medium text-rose-800">Blocked: {preview.blockers.filter((b) => b.blocking).map((b) => `${b.label} (${n0(b.shifts)} shifts)`).join("; ")}.</div>
                <label className="mt-1 flex items-start gap-2 text-slate-700"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-0.5" /><span>I understand — apply anyway. The override and the blockers it waved through are recorded on the change.</span></label>
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={confirmApply} disabled={pending || (preview.blockers.some((b) => b.blocking) && !override)} className="rounded-lg bg-rose-600 px-3 py-1.5 font-medium text-white hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400">{pending ? "Working…" : "Confirm and apply"}</button>
              <button onClick={() => { setPreview(null); setOverride(false); }} disabled={pending} className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-white">Cancel</button>
            </div>
          </div>
        )}
        <ChangeHistory changes={changes} onUndo={undo} pending={pending} />
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-slate-300 text-sm">
        {([["bottlenecks", `Bottlenecks & fixes (${plan.bottlenecks.length})`], ["overview", "Week by week"], ["sites", `Sites (${plan.sites.filter((x) => x.sections > 0).length})`], ["plan", `Every shift — where it could go (${n0(plan.assignments.length)})`], ["students", `By student (${plan.rosters.length})`], ["preceptors", `By preceptor (${plan.preceptorStats.length})`]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 ${tab === k ? "bg-rose-600 font-medium text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{l}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-3 py-2 font-semibold">Setting</th><th className="px-3 py-2 font-semibold">Rotation types</th><th className="px-3 py-2 text-right font-semibold">Demand · shifts</th><th className="px-3 py-2 text-right font-semibold">Learner-shifts</th><th className="px-3 py-2 text-right font-semibold">Learner-hours</th><th className="px-3 py-2 text-right font-semibold">Supply seats (allowed)</th><th className="px-3 py-2 text-right font-semibold" title="allowed seats on the dates and shift blocks this setting's demand uses, honouring the Day and Shift levers">Supply on demand days</th><th className="px-3 py-2 text-right font-semibold" title="supply on demand days − hand-made bookings − demand learner-shifts">Headroom</th><th className="px-3 py-2 text-right font-semibold">Asset-shifts allowed / physical</th><th className="px-3 py-2 text-right font-semibold">Can be placed</th><th className="px-3 py-2 text-right font-semibold">Cannot</th><th className="px-3 py-2 text-right font-semibold">Utilization</th><th className="px-3 py-2 font-semibold">Verdict</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plan.balance.map((b) => (
                  <tr key={b.settingCode} className={b.demandShifts === 0 ? "text-slate-400" : ""}>
                    <td className="px-3 py-1.5 whitespace-nowrap"><span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-white">{b.settingCode}</span> <span className="text-slate-700">{b.setting}</span></td>
                    <td className="px-3 py-1.5 text-slate-500">{b.rotationTypes.join(", ") || "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{n0(b.demandShifts)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{n0(b.demandSeats)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{n0(b.demandHours)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{n0(b.seatsAllowed)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{n0(b.seatsOnDemandDays)}{b.seatsBooked ? <span className="text-slate-400" title="taken by hand-made bookings"> − {n0(b.seatsBooked)}</span> : null}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${b.demandShifts === 0 ? "" : b.headroom < 0 ? "font-semibold text-rose-700" : b.headroom === 0 ? "text-amber-700" : "text-emerald-700"}`}>{b.demandShifts === 0 ? "—" : signed(b.headroom)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{n0(b.supplyShiftsAllowed)} / {n0(b.supplyShiftsPhysical)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{n0(b.placedSeats)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${b.unmetShifts ? "font-semibold text-rose-700" : ""}`}>{n0(b.unmetShifts)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums"><div className="inline-flex items-center gap-1"><div className="h-1.5 w-16 rounded bg-slate-100"><div className={`h-1.5 rounded ${b.utilization > 0.85 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${Math.min(100, b.utilization * 100)}%` }} /></div>{pct(b.utilization)}</div></td>
                    <td className="px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${VERDICT[b.verdict]}`}>{VERDICT_LABEL[b.verdict]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Week × setting heat map */}
          {weekMondays.length > 0 && settingCodes.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-1 text-sm font-semibold text-slate-800">Week by week, setting by setting <span className="text-xs font-normal text-slate-500">· each cell: learner-shifts that can be placed / needed that week (seats of supply that week underneath) · click a red cell for its bottleneck</span></div>
              <div className="overflow-x-auto">
                <table className="text-[10px]">
                  <thead><tr><th className="sticky left-0 bg-white px-2 py-1 text-left font-semibold text-slate-500">Setting</th>{weekMondays.map((m) => <th key={m} className="px-1 py-1 text-center font-normal text-slate-400">{fmtW(m)}</th>)}</tr></thead>
                  <tbody>
                    {settingCodes.map((code) => (
                      <tr key={code}>
                        <td className="sticky left-0 whitespace-nowrap bg-white px-2 py-0.5 font-mono font-semibold text-slate-700" title={settingName(code)}>{code}</td>
                        {weekMondays.map((m) => {
                          const c = plan.weeks.find((w) => w.weekMonday === m && w.settingCode === code);
                          if (!c || c.demand === 0) return <td key={m} className="px-0.5 py-0.5"><div className="h-9 w-12 rounded bg-slate-50" title={c ? `${n0(c.supply)} seats of supply, no demand` : "no supply, no demand"} /></td>;
                          const ratio = c.placed / c.demand;
                          const bg = ratio >= 1 ? "bg-emerald-200 text-emerald-900" : ratio >= 0.7 ? "bg-amber-200 text-amber-900" : "bg-rose-300 text-rose-950";
                          return <td key={m} className="px-0.5 py-0.5"><button onClick={() => { if (c.unmet > 0) { setTab("bottlenecks"); setShowWhy(`${code}|${m}`); } }} className={`h-9 w-12 rounded ${bg} leading-tight`} title={`${settingName(code)} · week of ${fmtW(m)}: ${n0(c.placed)} of ${n0(c.demand)} learner-shifts can be placed · ${n0(c.supply)} seats of supply`}><span className="block font-semibold">{n0(c.placed)}/{n0(c.demand)}</span><span className="block opacity-70">{n0(c.supply)}</span></button></td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "bottlenecks" && (
        <div className="space-y-3">
          {plan.bottlenecks.length > 0 && (() => {
            const byReason = new Map<string, { reason: string; seats: number; sections: number; weeks: Set<string>; settings: Set<string>; fixes: Map<string, number> }>();
            for (const b of plan.bottlenecks) { const r = byReason.get(b.reason) ?? { reason: b.reason, seats: 0, sections: 0, weeks: new Set(), settings: new Set(), fixes: new Map() }; r.seats += b.seats; r.sections += b.shifts; r.weeks.add(b.weekMonday); r.settings.add(b.settingCode); for (const f of b.fixes) r.fixes.set(f, (r.fixes.get(f) ?? 0) + b.seats); byReason.set(b.reason, r); }
            const rows = [...byReason.values()].sort((a, b) => b.seats - a.seats);
            return (
              <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
                <div className="mb-2 text-sm font-semibold text-slate-800">Root causes, biggest first <span className="text-xs font-normal text-slate-500">· what keeps learner-shifts from a seat, and the fix that would recover the most</span></div>
                <div className="space-y-2">
                  {rows.map((r) => (
                    <div key={r.reason} className="rounded-lg bg-white p-3 ring-1 ring-rose-100">
                      <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-sm font-medium text-slate-800">{REASON_LABEL[r.reason as keyof typeof REASON_LABEL]}</span><span className="text-xs tabular-nums text-rose-700"><strong>{n0(r.seats)} learner-shifts</strong> · {n0(r.sections)} sections · {r.weeks.size} weeks · {[...r.settings].join(", ")}</span></div>
                      <div className="mt-1 h-1.5 w-full rounded bg-slate-100"><div className="h-1.5 rounded bg-rose-400" style={{ width: `${Math.max(2, (r.seats / Math.max(1, s.demandSeats - s.placedSeats)) * 100)}%` }} /></div>
                      <div className="mt-1 text-xs text-slate-600">Best fix: <strong className="text-slate-800">{[...r.fixes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"}</strong></div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          {plan.bottlenecks.length === 0 && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">Every shift in the window is placed under these levers. Tighten one (secured only, exact shift, nearest band, require a preceptor) to stress-test the plan.</p>}
          {plan.bottlenecks.map((b) => (
            <div key={b.key} className={`rounded-xl border bg-white p-4 ${showWhy === `${b.settingCode}|${b.weekMonday}` ? "border-rose-400 ring-2 ring-rose-200" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-slate-800"><span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-white">{b.settingCode}</span> {settingName(b.settingCode)} · week of {fmtW(b.weekMonday)}{b.block !== "any" ? ` · ${b.block} shift` : ""}</div>
                <div className="text-xs tabular-nums text-rose-700"><strong>{n0(b.seats)} learner-shifts</strong> in {n0(b.shifts)} shift{b.shifts === 1 ? "" : "s"} unplaced · {b.cohorts.join(", ")}</div>
              </div>
              <div className="mt-1 text-xs text-slate-700">Why: <strong>{REASON_LABEL[b.reason]}</strong></div>
              {(() => { const ex = plan.unmet.find((u) => u.reason === b.reason && u.unit.settingCode === b.settingCode && u.unit.weekMonday === b.weekMonday); return ex ? <div className="mt-1 text-xs text-slate-600">For example: {ex.detail}</div> : null; })()}
              <div className="mt-1.5 text-xs text-slate-700">What would fix it:</div>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-xs text-slate-600">{b.fixes.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          ))}
          {plan.unmet.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
              <summary className="cursor-pointer font-medium text-slate-700">Every shift without a seat ({plan.unmet.length})</summary>
              <div className="mt-2 overflow-x-auto"><table className="min-w-full"><thead className="text-left text-[10px] uppercase tracking-wide text-slate-400"><tr><th className="px-2 py-1">Date</th><th className="px-2 py-1">Shift</th><th className="px-2 py-1">Offering</th><th className="px-2 py-1">Course</th><th className="px-2 py-1">Section</th><th className="px-2 py-1">Setting</th><th className="px-2 py-1 text-right">Seats</th><th className="px-2 py-1">Why, specifically</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{plan.unmet.map((x) => <tr key={x.unit.id}><td className="whitespace-nowrap px-2 py-1">{fmtD(x.unit.date)}{x.unit.holiday ? <span className="ml-1 text-amber-700">({x.unit.holiday})</span> : null}</td><td className="px-2 py-1">{x.unit.block}</td><td className="px-2 py-1">{x.unit.cohort}</td><td className="px-2 py-1">{x.unit.courseCode}</td><td className="px-2 py-1">{x.unit.sectionIndex}/{x.unit.sectionCount}</td><td className="px-2 py-1">{x.unit.settingCode ?? <span className="text-amber-700">{x.unit.rotationType} (unmapped)</span>}</td><td className="px-2 py-1 text-right">{x.unit.seats}</td><td className="px-2 py-1 text-slate-600">{x.detail}</td></tr>)}</tbody></table></div>
            </details>
          )}
        </div>
      )}

      {tab === "sites" && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Site</th><th className="px-3 py-2 font-semibold">Agreement</th><th className="px-3 py-2 font-semibold">Drive time · county</th><th className="px-3 py-2 text-right font-semibold">Assets</th><th className="px-3 py-2 text-right font-semibold">Seats in window</th><th className="px-3 py-2 text-right font-semibold">Used</th><th className="px-3 py-2 text-right font-semibold">Utilization</th><th className="px-3 py-2 text-right font-semibold">Sections</th><th className="px-3 py-2 text-right font-semibold">Learner-hours</th><th className="px-3 py-2 font-semibold">Settings</th><th className="px-3 py-2 font-semibold">Offerings</th><th className="px-3 py-2 text-right font-semibold">Preceptors on hand / peak need</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {plan.sites.map((x) => (
                <tr key={x.employerId} className={x.sections === 0 ? "text-slate-400" : ""}>
                  <td className="px-3 py-1.5 font-medium text-slate-800"><a href={`/employers/${x.employerId}`} className="hover:text-rose-700 hover:underline">{x.siteName}</a></td>
                  <td className="px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${AGREEMENT[x.agreementStatus] ?? AGREEMENT.none}`}>{x.agreementStatus}</span></td>
                  <td className="px-3 py-1.5 text-slate-500">{[driveBandLabel(x.ring), x.county].filter(Boolean).join(" · ")}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{x.assets}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{n0(x.slotSeats)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{n0(x.usedSeats)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums"><div className="inline-flex items-center gap-1"><div className="h-1.5 w-16 rounded bg-slate-100"><div className={`h-1.5 rounded ${x.utilization > 0.85 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${Math.min(100, x.utilization * 100)}%` }} /></div>{pct(x.utilization)}</div></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{n0(x.sections)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{n0(x.hours)}</td>
                  <td className="px-3 py-1.5 font-mono text-[10px]">{x.settings.join(" ")}</td>
                  <td className="px-3 py-1.5 text-slate-600">{x.cohorts.join(", ")}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${x.preceptorShort > 0 ? "font-semibold text-amber-700" : ""}`}>{x.preceptorsOnHand} / {x.preceptorsPeak}{x.preceptorShort > 0 ? ` · ${n0(x.preceptorShort)} preceptor-shifts short` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "plan" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select value={planFilter.site} onChange={(e) => setPlanFilter({ ...planFilter, site: e.target.value })} className="rounded border border-slate-300 px-2 py-1"><option value="">every site</option>{sitesInPlan.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            <select value={planFilter.setting} onChange={(e) => setPlanFilter({ ...planFilter, setting: e.target.value })} className="rounded border border-slate-300 px-2 py-1"><option value="">every setting</option>{settingCodes.map((x) => <option key={x} value={x}>{x} · {settingName(x)}</option>)}</select>
            <select value={planFilter.cohort} onChange={(e) => setPlanFilter({ ...planFilter, cohort: e.target.value })} className="rounded border border-slate-300 px-2 py-1"><option value="">every offering</option>{cohortsInDemand.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
            <input value={planFilter.q} onChange={(e) => setPlanFilter({ ...planFilter, q: e.target.value })} placeholder="course, preceptor, instructor, asset id…" className="w-64 rounded border border-slate-300 px-2 py-1" />
            <span className="text-slate-400">{n0(filteredPlan.length)} of {n0(plan.assignments.length)} placed shifts</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-2 font-semibold">Date</th><th className="px-2 py-2 font-semibold">Shift</th><th className="px-2 py-2 font-semibold">Offering</th><th className="px-2 py-2 font-semibold">Course · section</th><th className="px-2 py-2 font-semibold">Setting</th><th className="px-2 py-2 text-right font-semibold">Seats</th><th className="px-2 py-2 font-semibold">Site · asset</th><th className="px-2 py-2 font-semibold">Preceptor(s)</th><th className="px-2 py-2 font-semibold">Instructor</th><th className="px-2 py-2 text-right font-semibold">Hours</th><th className="px-2 py-2 font-semibold">Ready?</th><th className="px-2 py-2 font-semibold">Why here</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPlan.slice(0, 600).map((x) => <PlanRow key={`${x.unit.id}|${x.employerId}|${x.seatOffset}`} x={x} />)}
              </tbody>
            </table>
            {filteredPlan.length > 600 && <p className="px-3 py-2 text-[11px] text-slate-400">Showing the first 600 — filter to narrow.</p>}
          </div>
        </div>
      )}

      {tab === "students" && (
        <div className="space-y-2">
          {plan.rosters.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">No enrolled students on these offerings yet — the plan is placed by section (seats); students inherit their section&apos;s sites once they are on the roster with a section number.</p>}
          {plan.rosters.length > 0 && (() => {
            const statOf = new Map(plan.studentStats.map((s) => [s.student.id, s]));
            return (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Student</th><th className="px-3 py-2 font-semibold">Offering · section · home</th><th className="px-3 py-2 font-semibold">Where they go, in order</th><th className="px-3 py-2 text-right font-semibold">Shifts</th><th className="px-3 py-2 text-right font-semibold">Hours</th><th className="px-3 py-2 text-right font-semibold" title="distinct sites">Sites</th><th className="px-3 py-2 font-semibold" title="kinds of facility seen">Facility types</th><th className="px-3 py-2 text-right font-semibold" title="distinct health systems">Systems</th><th className="px-3 py-2 text-right font-semibold" title="distinct preceptors">Preceptors</th><th className="px-3 py-2 text-right font-semibold" title="longest run of shifts with the same preceptor">Longest with one</th><th className="px-3 py-2 text-right font-semibold" title="average / farthest drive from home">Drive avg · max</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {plan.rosters.map((r) => {
                      const s = statOf.get(r.student.id);
                      return (
                        <tr key={r.student.id}>
                          <td className="px-3 py-1.5 font-medium text-slate-800">{r.student.name}</td>
                          <td className="px-3 py-1.5 text-slate-500">{r.cohort} · section {r.student.sectionIndex}{r.student.homeLabel ? ` · ${r.student.homeLabel}` : ""}</td>
                          <td className="px-3 py-1.5"><div className="flex flex-wrap gap-1">{r.stops.map((st, i) => <span key={i} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5" title={`${st.settings.join(", ")} · ${n0(st.hours)} h`}>{st.siteName} <span className="text-slate-400">{fmtW(st.from)}{st.to !== st.from ? `–${fmtW(st.to)}` : ""} · {st.shifts}</span></span>)}</div></td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{n0(r.stops.reduce((n, st) => n + st.shifts, 0))}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{n0(r.stops.reduce((n, st) => n + st.hours, 0))}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{s?.sites ?? "—"}</td>
                          <td className="px-3 py-1.5 text-slate-600">{s?.facilityTypes.join(", ") || "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{s?.systems ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{s?.preceptors ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{s ? `${s.longestPreceptorRun} shifts` : "—"}</td>
                          <td className={`px-3 py-1.5 text-right tabular-nums ${s?.shiftsOverCap ? "font-semibold text-rose-700" : ""}`}>{s ? `${min(s.avgDriveMin)} · ${min(s.maxDriveMin)}${s.shiftsOverCap ? ` · ${s.shiftsOverCap} over cap` : ""}` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      {tab === "preceptors" && (
        <div className="space-y-2">
          {plan.preceptorStats.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">No preceptors named in the plan — sites need preceptors on record for the plan to staff shifts by name.</p>}
          {plan.preceptorStats.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Preceptor</th><th className="px-3 py-2 font-semibold">Their site</th><th className="px-3 py-2 text-right font-semibold">Shifts</th><th className="px-3 py-2 text-right font-semibold" title="student shifts in the busiest week">Busiest week</th><th className="px-3 py-2 text-right font-semibold">Students</th><th className="px-3 py-2 font-semibold">Check</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {plan.preceptorStats.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-1.5 font-medium text-slate-800">{p.name}</td>
                      <td className="px-3 py-1.5 text-slate-600">{p.siteName ?? <span className="text-amber-700">no employer on record</span>}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{n0(p.shifts)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${p.overCapWeeks ? "font-semibold text-amber-700" : ""}`}>{p.peakWeek}{p.overCapWeeks ? ` · over the ceiling ${p.overCapWeeks} week${p.overCapWeeks === 1 ? "" : "s"}` : ""}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{p.students}</td>
                      <td className="px-3 py-1.5">{p.sites > 1 ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-800">at {p.sites} sites — should never happen</span> : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">only at their own site</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PlanRow({ x }: { x: Assignment }) {
  return (
    <tr>
      <td className="whitespace-nowrap px-2 py-1">{fmtD(x.date)}{x.movedDays ? <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800" title={`moved from ${fmtD(x.unit.date)}`}>{x.movedDays > 0 ? "+" : ""}{x.movedDays}d</span> : null}</td>
      <td className="px-2 py-1">{x.block}{x.changedBlock ? <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800" title={`session says ${x.unit.block}`}>was {x.unit.block}</span> : null}</td>
      <td className="px-2 py-1 text-slate-700">{x.unit.cohort}</td>
      <td className="px-2 py-1"><span className="font-mono text-slate-700">{x.unit.courseCode}</span> <span className="text-slate-400">§{x.unit.sectionIndex}/{x.unit.sectionCount}</span>{x.splitOf > 1 && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800" title="this section is split across sites on this shift">split</span>}</td>
      <td className="px-2 py-1 font-mono text-[10px]">{x.unit.settingCode}</td>
      <td className="px-2 py-1 text-right tabular-nums">{x.seats}</td>
      <td className="px-2 py-1"><span className="font-medium text-slate-800">{x.siteName}</span> <span className="text-slate-400">{x.parts.map((p) => `${p.asset.externalId ?? `${p.asset.settingCode}-${p.asset.assetNumber}`}${x.parts.length > 1 ? `×${p.seats}` : ""}`).join(", ")}</span></td>
      <td className="px-2 py-1">{x.preceptorNames.length ? x.preceptorNames.join(", ") : x.unit.preceptorsNeeded > 0 ? <span className="text-amber-700">none free</span> : <span className="text-slate-300">—</span>}</td>
      <td className="px-2 py-1">{x.instructorName ?? (x.unit.facultyNeeded >= 1 ? <span className="text-amber-700">none free</span> : <span className="text-slate-300" title={`${x.unit.facultyNeeded} FTE oversight, not a whole person`}>oversight</span>)}</td>
      <td className="px-2 py-1 text-right tabular-nums">{n0(x.hours)}</td>
      <td className="px-2 py-1">{x.readiness?.ready ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">ready</span> : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800" title={x.readiness?.issues.join("; ")}>{x.readiness?.issues[0] ?? "not ready"}</span>}</td>
      <td className="px-2 py-1 text-[10px] text-slate-500">{x.reason}</td>
    </tr>
  );
}

function Tile({ label, v, sub, strong, tone }: { label: string; v: string; sub?: string; strong?: boolean; tone?: "rose" | "amber" | "emerald" }) {
  const bg = strong ? "bg-slate-800 text-white" : tone === "rose" ? "bg-rose-50 text-rose-900" : tone === "amber" ? "bg-amber-50 text-amber-900" : tone === "emerald" ? "bg-emerald-50 text-emerald-900" : "bg-slate-50 text-slate-800";
  return (
    <div className={`rounded-lg p-2.5 ${bg}`}>
      <div className={`text-[10px] uppercase tracking-wide ${strong ? "text-slate-300" : "opacity-70"}`}>{label}</div>
      <div className="text-xl font-bold leading-tight tabular-nums">{v}</div>
      {sub && <div className={`truncate text-[10px] ${strong ? "text-slate-200" : "opacity-90"}`} title={sub}>{sub}</div>}
    </div>
  );
}
