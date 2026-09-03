"use client";

// The clinical scheduler board — supply vs demand, the recommended plan, and
// the analytics layers around it. Reads like a briefing: one sentence, then
// six numbers, then the balance by setting, the week × setting heat map, the
// sites, the ranked bottlenecks (each with what would fix it), and finally the
// plan itself — by shift, and by student. The levers on top re-run everything.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildInstances, type CohortCalendarInput, type DatedInstance } from "@/lib/capacitymodel";
import { demandUnits, recommendPlan, DEFAULT_POLICY, AUTO_PLAN_NOTE, REASON_LABEL, type Policy, type Plan, type Preceptor, type Instructor, type StudentLite, type FamilyAgreement, type Assignment } from "@/lib/scheduler";
import type { AssetLite, AssetDayOverride, AssetBookingLite } from "@/lib/assetmap";
import type { CapacityCohort } from "@/components/CapacityBoard";
import type { RotationCodeRow } from "@/components/AssetMapBoard";
import { applySchedulerPlan, clearSchedulerPlan } from "@/lib/actions";

const n0 = (v: number) => Math.round(v).toLocaleString();
const pct = (v: number) => `${Math.round(v * 100)}%`;
const fmtD = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const fmtW = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const AGREEMENT: Record<string, string> = { none: "bg-slate-100 text-slate-500", prospect: "bg-sky-100 text-sky-700", asked: "bg-amber-100 text-amber-700", secured: "bg-emerald-100 text-emerald-700", declined: "bg-rose-100 text-rose-700" };
const VERDICT: Record<string, string> = { fits: "bg-emerald-100 text-emerald-800", tight: "bg-amber-100 text-amber-800", short: "bg-rose-100 text-rose-800", none: "bg-slate-100 text-slate-500" };
const VERDICT_LABEL: Record<string, string> = { fits: "fits", tight: "tight", short: "short", none: "no demand" };
type Tab = "overview" | "bottlenecks" | "sites" | "plan" | "students";

export function SchedulerBoard({ institutionId, cohorts, assets, overrides, bookings, rotations, preceptors, instructors, students, familyAgreements, from, to }: {
  institutionId: string; cohorts: CapacityCohort[]; assets: AssetLite[]; overrides: AssetDayOverride[]; bookings: (AssetBookingLite & { note?: string | null })[]; rotations: RotationCodeRow[];
  preceptors: Preceptor[]; instructors: Instructor[]; students: StudentLite[]; familyAgreements: FamilyAgreement[]; from: string; to: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [tab, setTab] = useState<Tab>("overview");
  const [cohortFilter, setCohortFilter] = useState<Set<string>>(new Set());
  const [window, setWindow] = useState<{ from: string; to: string }>({ from, to });
  const [planFilter, setPlanFilter] = useState<{ site: string; setting: string; cohort: string; q: string }>({ site: "", setting: "", cohort: "", q: "" });
  const [applied, setApplied] = useState<{ bookings: number; placements: number; meetings: number } | null>(null);
  const [showWhy, setShowWhy] = useState<string | null>(null);

  // Demand: every dated clinical section of the selected offerings inside the window.
  const rows: DatedInstance[] = useMemo(() => cohorts.flatMap((c) => buildInstances({
    cohortId: c.cohortId, cohort: c.cohort, programId: c.programId, program: c.program, enrollmentByTerm: c.enrollmentByTerm,
    termStartByIndex: Object.fromEntries(Object.entries(c.termStartByIndex).map(([k, v]) => [k, v ? new Date(v) : null])), holidays: c.holidays, courses: c.courses,
  } as CohortCalendarInput, c.assumptions).filter((i) => i.dateIso != null)), [cohorts]);
  const familyByCohort = useMemo(() => Object.fromEntries(cohorts.map((c) => [c.cohortId, (c as unknown as { familyId?: string | null }).familyId ?? null])), [cohorts]);
  const demandAll = useMemo(() => demandUnits(rows, rotations, cohorts.flatMap((c) => (c.moves ?? []).map((m) => ({ sessionId: m.sessionId, sectionIndex: m.sectionIndex, fromDate: m.fromDate, toDate: m.toDate, startTime: m.startTime ?? null }))), familyByCohort), [rows, rotations, cohorts, familyByCohort]);
  const demand = useMemo(() => demandAll.filter((u) => (cohortFilter.size === 0 || cohortFilter.has(u.cohortId)) && u.date >= window.from && u.date <= window.to), [demandAll, cohortFilter, window]);
  const manualBookings = useMemo(() => bookings.filter((b) => b.note !== AUTO_PLAN_NOTE), [bookings]);
  const autoBookings = useMemo(() => bookings.filter((b) => b.note === AUTO_PLAN_NOTE), [bookings]);

  const plan: Plan = useMemo(() => recommendPlan({ demand, assets, overrides, existingBookings: manualBookings, preceptors, instructors, students, familyAgreements, policy }), [demand, assets, overrides, manualBookings, preceptors, instructors, students, familyAgreements, policy]);
  const s = plan.summary;
  const settingName = (code: string) => plan.balance.find((b) => b.settingCode === code)?.setting ?? code;
  const weekMondays = useMemo(() => [...new Set(plan.weeks.map((w) => w.weekMonday))].sort(), [plan]);
  const settingCodes = useMemo(() => plan.balance.filter((b) => b.demandShifts > 0).map((b) => b.settingCode), [plan]);
  const cohortsInDemand = useMemo(() => [...new Set(demandAll.map((u) => `${u.cohortId}|${u.cohort} · ${u.program}`))].map((x) => { const [id, label] = x.split("|"); return { id, label }; }), [demandAll]);
  const sitesInPlan = useMemo(() => [...new Set(plan.assignments.map((x) => x.siteName))].sort(), [plan]);
  const filteredPlan = useMemo(() => plan.assignments.filter((x) => (!planFilter.site || x.siteName === planFilter.site) && (!planFilter.setting || x.unit.settingCode === planFilter.setting) && (!planFilter.cohort || x.unit.cohortId === planFilter.cohort) && (!planFilter.q || `${x.unit.courseCode} ${x.unit.courseTitle} ${x.preceptorNames.join(" ")} ${x.instructorName ?? ""} ${x.asset.externalId ?? ""}`.toLowerCase().includes(planFilter.q.toLowerCase()))), [plan, planFilter]);
  const cohortIdsInPlan = useMemo(() => [...new Set(plan.assignments.map((x) => x.unit.cohortId))], [plan]);

  const apply = () => startTransition(async () => {
    const r = await applySchedulerPlan(institutionId, plan.assignments.map((x) => ({ assetId: x.assetId, employerId: x.employerId, cohortId: x.unit.cohortId, sessionId: x.unit.sessionId, sectionIndex: x.unit.sectionIndex, courseId: x.unit.courseId, date: x.date, block: x.block, seats: x.seats, seatsPerSection: x.unit.seatsPerSection, preceptorIds: x.preceptorIds, instructorId: x.instructorId, parts: x.parts.map((p) => ({ assetId: p.assetId, seats: p.seats })), seatOffset: x.seatOffset })));
    setApplied(r); router.refresh();
  });
  const clear = () => startTransition(async () => { await clearSchedulerPlan(cohortIdsInPlan.length ? cohortIdsInPlan : [...new Set(autoBookings.map((b) => b.cohortId))]); setApplied(null); router.refresh(); });

  const Lever = ({ label, children, hint }: { label: string; children: React.ReactNode; hint: string }) => (
    <label className="block rounded-lg border border-slate-200 bg-white px-2.5 py-1.5" title={hint}>
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  );
  const sel = "mt-0.5 w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs";

  return (
    <section className="space-y-4">
      {/* ── Levers ────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-semibold text-slate-800">Levers <span className="font-normal text-slate-500">— the rules the plan is built under; everything below recomputes as you change them</span></div>
          <button onClick={() => setPolicy(DEFAULT_POLICY)} className="text-[11px] text-slate-500 hover:text-rose-700">reset levers</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Lever label="Sites that count" hint="Which partner agreements may host learners. A program family's own agreement with a site wins over the institution-level one.">
            <select value={policy.agreements} onChange={(e) => setPolicy({ ...policy, agreements: e.target.value as Policy["agreements"] })} className={sel}><option value="secured">secured only</option><option value="secured+asked">secured + asked</option><option value="any">any partner with the asset</option></select>
          </Lever>
          <Lever label="Shift" hint="May a section land on a different shift block (day / evening / night) than its session says?">
            <select value={String(policy.flexibleShift)} onChange={(e) => setPolicy({ ...policy, flexibleShift: e.target.value === "true" })} className={sel}><option value="false">exact shift only</option><option value="true">any shift the asset runs</option></select>
          </Lever>
          <Lever label="Day" hint="May a section move inside its week to a day the asset is open?">
            <select value={String(policy.flexibleDays)} onChange={(e) => setPolicy({ ...policy, flexibleDays: Number(e.target.value) as Policy["flexibleDays"] })} className={sel}><option value="0">exact date</option><option value="1">± 1 day in the week</option><option value="2">± 2 days in the week</option></select>
          </Lever>
          <Lever label="Drive ring" hint="Farthest ring a site may be in.">
            <select value={policy.maxRing} onChange={(e) => setPolicy({ ...policy, maxRing: e.target.value as Policy["maxRing"] })} className={sel}><option value="Core">Core only</option><option value="Ring 1">up to Ring 1</option><option value="Ring 2">up to Ring 2</option><option value="any">any distance</option></select>
          </Lever>
          <Lever label="Continuity" hint="Keep a section at the same site for the whole course wherever possible.">
            <select value={String(policy.continuity)} onChange={(e) => setPolicy({ ...policy, continuity: e.target.value === "true" })} className={sel}><option value="true">keep each section at one site</option><option value="false">any site each shift</option></select>
          </Lever>
          <Lever label="Balance" hint="Prefer the least-loaded site over the closest / most secured one.">
            <select value={String(policy.spread)} onChange={(e) => setPolicy({ ...policy, spread: e.target.value === "true" })} className={sel}><option value="false">closest & most secured first</option><option value="true">spread load across sites</option></select>
          </Lever>
          <Lever label="Preceptors" hint="Only place a section where a free preceptor person exists at that site on that shift.">
            <select value={String(policy.requirePreceptor)} onChange={(e) => setPolicy({ ...policy, requirePreceptor: e.target.value === "true" })} className={sel}><option value="false">count seats only</option><option value="true">require a free preceptor</option></select>
          </Lever>
          <Lever label="Split sections" hint="When no single site can seat a whole section on one shift, may it split across sites? Preceptor-led sections can (students are 1:1 with a preceptor anyway); an instructor-led group travels together.">
            <select value={policy.split} onChange={(e) => setPolicy({ ...policy, split: e.target.value as Policy["split"] })} className={sel}><option value="preceptor-led">preceptor-led may split</option><option value="none">never split a section</option><option value="any">any section may split</option></select>
          </Lever>
          <Lever label="Holidays" hint="Sessions that land on an observed holiday are left unplaced so someone moves them, or placed anyway.">
            <select value={String(policy.skipHolidays)} onChange={(e) => setPolicy({ ...policy, skipHolidays: e.target.value === "true" })} className={sel}><option value="true">leave for moving</option><option value="false">place anyway</option></select>
          </Lever>
        </div>
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

      {/* ── The statement + six numbers ──────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-base leading-relaxed text-slate-800">{s.statement}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label="Demand" v={`${n0(s.demandSeats)} learner-shifts`} sub={`${n0(s.demandShifts)} sections · ${n0(s.demandHours)} learner-hours`} />
          <Tile label="Supply that counts" v={`${n0(s.supplySeatsAllowed)} seats`} sub={`${n0(s.supplySeatsPhysical)} physical asset-shifts in the window`} />
          <Tile label="Placed" v={pct(s.placedShare)} sub={`${n0(s.placedSeats)} learner-shifts at ${s.sitesUsed} sites`} strong />
          <Tile label="Unplaced" v={n0(s.unmetShifts)} sub={s.unmetShifts ? `sections — see bottlenecks` : "nothing left over"} tone={s.unmetShifts ? "rose" : "emerald"} />
          <Tile label="Preceptors" v={`${n0(s.preceptorsAssigned)} / ${n0(s.preceptorShifts)}`} sub="preceptor-shifts staffed by name" tone={s.preceptorShifts > 0 && s.preceptorsAssigned < s.preceptorShifts ? "amber" : undefined} />
          <Tile label="Instructors" v={`${n0(s.instructorsAssigned)} / ${n0(s.instructorShifts)}`} sub="instructor-led shifts staffed" tone={s.instructorShifts > 0 && s.instructorsAssigned < s.instructorShifts ? "amber" : undefined} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <button onClick={apply} disabled={pending || plan.assignments.length === 0} className="rounded-lg bg-rose-600 px-3 py-1.5 font-medium text-white hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400">{pending ? "Working…" : `Apply this plan — book ${n0(plan.assignments.length)} sections`}</button>
          {(autoBookings.length > 0 || applied) && <button onClick={clear} disabled={pending} className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50">Clear the applied plan</button>}
          <span className="text-slate-500">
            {applied ? <span className="text-emerald-700">Applied: {n0(applied.bookings)} bookings, {n0(applied.meetings)} sections pointed at their site, {n0(applied.placements)} student placements.</span> : autoBookings.length > 0 ? `${n0(autoBookings.length)} bookings from an earlier applied plan are on the books (they will be replaced).` : "Applying writes bookings onto assets, points each section's calendar pattern at its site and lead preceptor, and gives every student a planned placement. Hand-made bookings are never touched."}
            {manualBookings.length > 0 && ` ${n0(manualBookings.length)} hand-made bookings already take seats.`}
          </span>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-slate-300 text-sm">
        {([["overview", "Balance by setting & week"], ["bottlenecks", `Bottlenecks (${plan.bottlenecks.length})`], ["sites", `Sites (${plan.sites.filter((x) => x.sections > 0).length})`], ["plan", `The plan — by shift (${plan.assignments.length})`], ["students", `By student (${plan.rosters.length})`]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 ${tab === k ? "bg-rose-600 font-medium text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{l}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-3 py-2 font-semibold">Setting</th><th className="px-3 py-2 font-semibold">Rotation types</th><th className="px-3 py-2 text-right font-semibold">Demand · sections</th><th className="px-3 py-2 text-right font-semibold">Learner-shifts</th><th className="px-3 py-2 text-right font-semibold">Learner-hours</th><th className="px-3 py-2 text-right font-semibold">Supply seats (allowed)</th><th className="px-3 py-2 text-right font-semibold">Asset-shifts allowed / physical</th><th className="px-3 py-2 text-right font-semibold">Placed</th><th className="px-3 py-2 text-right font-semibold">Unplaced</th><th className="px-3 py-2 text-right font-semibold">Utilization</th><th className="px-3 py-2 font-semibold">Verdict</th></tr>
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
              <div className="mb-1 text-sm font-semibold text-slate-800">Week by week, setting by setting <span className="text-xs font-normal text-slate-500">· each cell: placed / demanded learner-shifts (supply seats that week underneath) · click a red cell for its bottleneck</span></div>
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
                          return <td key={m} className="px-0.5 py-0.5"><button onClick={() => { if (c.unmet > 0) { setTab("bottlenecks"); setShowWhy(`${code}|${m}`); } }} className={`h-9 w-12 rounded ${bg} leading-tight`} title={`${settingName(code)} · week of ${fmtW(m)}: ${n0(c.placed)} of ${n0(c.demand)} learner-shifts placed · ${n0(c.supply)} seats of supply`}><span className="block font-semibold">{n0(c.placed)}/{n0(c.demand)}</span><span className="block opacity-70">{n0(c.supply)}</span></button></td>;
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
                <div className="mb-2 text-sm font-semibold text-slate-800">Root causes, biggest first <span className="text-xs font-normal text-slate-500">· what is keeping learner-shifts unplaced, and the fix that would recover the most</span></div>
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
          {plan.bottlenecks.length === 0 && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">Everything in the window is placed under the current levers. Tighten a lever (secured only, exact shift, Core ring, require a preceptor) to stress-test the plan.</p>}
          {plan.bottlenecks.map((b) => (
            <div key={b.key} className={`rounded-xl border bg-white p-4 ${showWhy === `${b.settingCode}|${b.weekMonday}` ? "border-rose-400 ring-2 ring-rose-200" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-slate-800"><span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-white">{b.settingCode}</span> {settingName(b.settingCode)} · week of {fmtW(b.weekMonday)}{b.block !== "any" ? ` · ${b.block} shift` : ""}</div>
                <div className="text-xs tabular-nums text-rose-700"><strong>{n0(b.seats)} learner-shifts</strong> in {n0(b.shifts)} section{b.shifts === 1 ? "" : "s"} unplaced · {b.cohorts.join(", ")}</div>
              </div>
              <div className="mt-1 text-xs text-slate-700">Why: <strong>{REASON_LABEL[b.reason]}</strong></div>
              <div className="mt-1.5 text-xs text-slate-700">What would fix it:</div>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-xs text-slate-600">{b.fixes.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          ))}
          {plan.unmet.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
              <summary className="cursor-pointer font-medium text-slate-700">Every unplaced section ({plan.unmet.length})</summary>
              <div className="mt-2 overflow-x-auto"><table className="min-w-full"><thead className="text-left text-[10px] uppercase tracking-wide text-slate-400"><tr><th className="px-2 py-1">Date</th><th className="px-2 py-1">Shift</th><th className="px-2 py-1">Offering</th><th className="px-2 py-1">Course</th><th className="px-2 py-1">Section</th><th className="px-2 py-1">Setting</th><th className="px-2 py-1 text-right">Seats</th><th className="px-2 py-1">Reason</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{plan.unmet.map((x) => <tr key={x.unit.id}><td className="whitespace-nowrap px-2 py-1">{fmtD(x.unit.date)}{x.unit.holiday ? <span className="ml-1 text-amber-700">({x.unit.holiday})</span> : null}</td><td className="px-2 py-1">{x.unit.block}</td><td className="px-2 py-1">{x.unit.cohort}</td><td className="px-2 py-1">{x.unit.courseCode}</td><td className="px-2 py-1">{x.unit.sectionIndex}/{x.unit.sectionCount}</td><td className="px-2 py-1">{x.unit.settingCode ?? <span className="text-amber-700">{x.unit.rotationType} (unmapped)</span>}</td><td className="px-2 py-1 text-right">{x.unit.seats}</td><td className="px-2 py-1 text-slate-500">{REASON_LABEL[x.reason].split(" — ")[0]}</td></tr>)}</tbody></table></div>
            </details>
          )}
        </div>
      )}

      {tab === "sites" && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Site</th><th className="px-3 py-2 font-semibold">Agreement</th><th className="px-3 py-2 font-semibold">Ring · county</th><th className="px-3 py-2 text-right font-semibold">Assets</th><th className="px-3 py-2 text-right font-semibold">Seats in window</th><th className="px-3 py-2 text-right font-semibold">Used</th><th className="px-3 py-2 text-right font-semibold">Utilization</th><th className="px-3 py-2 text-right font-semibold">Sections</th><th className="px-3 py-2 text-right font-semibold">Learner-hours</th><th className="px-3 py-2 font-semibold">Settings</th><th className="px-3 py-2 font-semibold">Offerings</th><th className="px-3 py-2 text-right font-semibold">Preceptors on hand / peak need</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {plan.sites.map((x) => (
                <tr key={x.employerId} className={x.sections === 0 ? "text-slate-400" : ""}>
                  <td className="px-3 py-1.5 font-medium text-slate-800"><a href={`/employers/${x.employerId}`} className="hover:text-rose-700 hover:underline">{x.siteName}</a></td>
                  <td className="px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${AGREEMENT[x.agreementStatus] ?? AGREEMENT.none}`}>{x.agreementStatus}</span></td>
                  <td className="px-3 py-1.5 text-slate-500">{[x.ring, x.county].filter(Boolean).join(" · ")}</td>
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
            <span className="text-slate-400">{n0(filteredPlan.length)} of {n0(plan.assignments.length)} placed sections</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-2 font-semibold">Date</th><th className="px-2 py-2 font-semibold">Shift</th><th className="px-2 py-2 font-semibold">Offering</th><th className="px-2 py-2 font-semibold">Course · section</th><th className="px-2 py-2 font-semibold">Setting</th><th className="px-2 py-2 text-right font-semibold">Seats</th><th className="px-2 py-2 font-semibold">Site · asset</th><th className="px-2 py-2 font-semibold">Preceptor(s)</th><th className="px-2 py-2 font-semibold">Instructor</th><th className="px-2 py-2 text-right font-semibold">Hours</th><th className="px-2 py-2 font-semibold">Why here</th></tr></thead>
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
          {plan.rosters.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Student</th><th className="px-3 py-2 font-semibold">Offering · section</th><th className="px-3 py-2 font-semibold">Where they go, in order</th><th className="px-3 py-2 text-right font-semibold">Shifts</th><th className="px-3 py-2 text-right font-semibold">Hours</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {plan.rosters.map((r) => (
                    <tr key={r.student.id}>
                      <td className="px-3 py-1.5 font-medium text-slate-800">{r.student.name}</td>
                      <td className="px-3 py-1.5 text-slate-500">{r.cohort} · section {r.student.sectionIndex}</td>
                      <td className="px-3 py-1.5"><div className="flex flex-wrap gap-1">{r.stops.map((st, i) => <span key={i} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5" title={`${st.settings.join(", ")} · ${n0(st.hours)} h`}>{st.siteName} <span className="text-slate-400">{fmtW(st.from)}{st.to !== st.from ? `–${fmtW(st.to)}` : ""} · {st.shifts}</span></span>)}</div></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{n0(r.stops.reduce((n, st) => n + st.shifts, 0))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{n0(r.stops.reduce((n, st) => n + st.hours, 0))}</td>
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
      <td className="px-2 py-1 text-right tabular-nums">{x.hours}</td>
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
      {sub && <div className={`truncate text-[10px] ${strong ? "text-slate-300" : "opacity-70"}`} title={sub}>{sub}</div>}
    </div>
  );
}
