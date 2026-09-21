import Link from "next/link";
import { notFound } from "next/navigation";
import { getOffering, getCapacityModel, getOfferingStaffing, getOfferingLedger, getRotationBoard, getCohortRequirementProgress } from "@/lib/queries";
import { RotationBoard } from "@/components/RotationBoard";
import { CohortRequirementProgress } from "@/components/CohortRequirementProgress";
import { OfferingLedger } from "@/components/OfferingLedger";
import { OfferingStaffing } from "@/components/OfferingStaffing";
import { AutoAssignButton } from "@/components/AutoAssignButton";
import { updateOfferingDates, saveCourseDates, updateOfferingLocation } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { FunnelChart } from "@/components/FunnelChart";
import { CourseSequencer, type SeqCourse, type SeqTerm } from "@/components/CourseSequencer";
import { fmt, dec } from "@/lib/format";
import { outcomeStats } from "@/lib/learners";
import type { StageKey } from "@/lib/funnel";
import { computeCohortTiming, calendarWeeksBetween, seasonOfTerm, type TimingTerm } from "@/lib/term";
import { buildInstances, lastSessionDate, weeklyNeedByKind, type CohortCalendarInput } from "@/lib/capacitymodel";
import { CapacityBoard } from "@/components/CapacityBoard";
import { Collapse } from "@/components/Collapse";
import { ProvisionalDatesBanner, UnverifiedStandard } from "@/components/Evidence";
import { OfferingPipelineEditor } from "@/components/OfferingPipelineEditor";
import { BENCHMARK_RATES, type LadderRates } from "@/lib/northstar";
import { alignOffering, SOURCE_LABEL, type DateSource } from "@/lib/termalign";
import { OPERATIONAL } from "@/lib/mode";
import { ReadOnly } from "@/components/ReadOnly";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const dateFmt = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");

const PHASE_LABEL: Record<string, string> = { recruiting: "Recruiting", "in-program": "In program", graduated: "Graduated", unscheduled: "Unscheduled" };
const PHASE_BADGE: Record<string, string> = {
  recruiting: "bg-sky-100 text-sky-700", "in-program": "bg-emerald-100 text-emerald-700",
  graduated: "bg-slate-200 text-slate-600", unscheduled: "bg-slate-100 text-slate-400",
};
const n1 = (v: number) => dec(v);

export default async function OfferingPage({ params, searchParams }: { params: { id: string; cohortId: string }; searchParams?: { course?: string } }) {
  const offering = await getOffering(params.cohortId);
  if (!offering || offering.programId !== params.id) notFound();
  const program = offering.program;
  const [capModel, staffing, ledger, rotations, reqProgress, campuses] = await Promise.all([getCapacityModel({ cohortId: params.cohortId }), getOfferingStaffing(params.cohortId), getOfferingLedger(params.cohortId), getRotationBoard(params.cohortId, searchParams?.course ?? null), getCohortRequirementProgress(params.cohortId), prisma.campus.findMany({ where: { institutionId: program.institutionId }, orderBy: [{ isMain: "desc" }, { name: "asc" }], select: { id: true, name: true, city: true } })]);

  // Real date per template term for THIS offering.
  const termDate = new Map(offering.cohortTerms.map((ct) => [ct.termId, ct.startDate]));

  const today = new Date();
  const orderedTerms = [...program.terms].sort((a, b) => a.index - b.index);
  const timingTerms: TimingTerm[] = orderedTerms.map((t) => ({ index: t.index, name: t.name, startWeek: t.startWeek, endWeek: t.endWeek }));
  const realTermStarts = orderedTerms.map((t) => termDate.get(t.id) ?? null);
  const timing = computeCohortTiming(offering.startDate ?? null, timingTerms, today, realTermStarts);
  const exactDate = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

  // ── Real end date + holiday collisions for THIS offering (same engine
  //    as the Insights tabs; the full breakdown lives in the sections below). ──
  const capCohort = capModel?.cohorts.find((c) => c.cohortId === offering.id) ?? null;
  const sites = capModel?.clinicalSites ?? [];
  let lastDay: Date | null = null;
  let holidayHits = 0;
  let holidayMoved = 0;
  let peakFac = 0;
  let peakPre = 0;
  // Sessions whose template week is past the term's last week (a 16-week template in a 10-week summer) — undated, flagged.
  const beyondByTerm = new Map<string, { sessions: number; weeks: Set<number> }>();
  if (capCohort) {
    const input: CohortCalendarInput = {
      cohortId: capCohort.cohortId, cohort: capCohort.cohort, programId: capCohort.programId, program: capCohort.program,
      enrollmentByTerm: capCohort.enrollmentByTerm,
      termStartByIndex: Object.fromEntries(Object.entries(capCohort.termStartByIndex as Record<string, string | null>).map(([k, v]) => [k, v ? new Date(v) : null])),
      termEndByIndex: capCohort.termEndByIndex, termWeeksByIndex: capCohort.termWeeksByIndex,
      holidays: capCohort.holidays, holidayRule: capCohort.holidayRule,
      courses: capCohort.courses,
    };
    const all = buildInstances(input, capCohort.assumptions);
    for (const i of all) if (i.beyondTerm) { const b = beyondByTerm.get(i.termName) ?? { sessions: 0, weeks: new Set<number>() }; b.sessions += Math.max(1, Math.round(i.computed.Y ?? 1)); b.weeks.add(i.weekOfTerm); beyondByTerm.set(i.termName, b); }
    const instances = all.filter((i) => i.mondayIso != null);
    lastDay = lastSessionDate(instances);
    holidayHits = instances.filter((i) => i.holiday).length;
    holidayMoved = instances.filter((i) => i.holidayMoved).length;
    const w = weeklyNeedByKind(instances);
    peakFac = Math.max(0, ...w.map((x) => x.totalFacFte));
    peakPre = Math.max(0, ...w.map((x) => x.preceptorFte));
  }

  // Learners sitting in the offering now (enrolled or further along; not withdrawn, not applicants).
  const enrolledNow = ledger ? ledger.students.filter((s) => s.status !== "withdrawn").length : offering._count.students;
  // Enrollment through each term — target ladder from the pipeline, rendered
  // inside the funnel under "Enrolled" so the whole journey reads top to bottom.
  const termEnrollment = capCohort
    ? orderedTerms.map((t) => ({
        label: `${t.name}`,
        target: capCohort.enrollmentByTerm[t.index] ?? 0,
        actual: timing.phase === "in-program" && timing.currentTermName === t.name ? enrolledNow : null,
        current: timing.phase === "in-program" && timing.currentTermName === t.name,
      }))
    : [];

  // THIS offering's saved plan (goal · per-term enrollment · rates), with the
  // family's default rates underneath.
  let defaultRates: LadderRates = { ...BENCHMARK_RATES };
  if (program.family?.goalPlan) { try { const gp = JSON.parse(program.family.goalPlan) as { goal?: Partial<LadderRates> }; if (gp.goal) defaultRates = { ...defaultRates, ...gp.goal }; } catch { /* benchmarks */ } }
  let savedPlan: { goal?: number; rates?: Partial<LadderRates>; termOverrides?: (number | null)[] } = {};
  if (offering.pipelineRates) { try { savedPlan = JSON.parse(offering.pipelineRates); } catch { /* none */ } }
  const ownRates: Partial<LadderRates> = {};
  for (const [k, v] of Object.entries(savedPlan.rates ?? {})) if (typeof v === "number" && v !== defaultRates[k as keyof LadderRates]) ownRates[k as keyof LadderRates] = v;
  const initialTargets = {
    goal: savedPlan.goal ?? offering.stages.find((s) => s.stageKey === "productive")?.targetNumber ?? 0,
    termOverrides: savedPlan.termOverrides ?? [],
    rates: ownRates,
  };

  // Sequence board inputs (template-wide; re-sequencing moves every offering).
  const seqTerms: SeqTerm[] = orderedTerms.map((t) => ({ id: t.id, name: t.name, courseCount: t.courses.length }));
  const seqCourses: SeqCourse[] = orderedTerms.flatMap((t) => t.courses.map((c) => ({
    id: c.id, code: c.code, name: c.name, termId: t.id, requisites: c.requisites,
    classCount: c.sessions.filter((s) => s.kind === "CLASS").length,
    labCount: c.sessions.filter((s) => s.kind === "LAB").length,
    clinicalCount: c.sessions.filter((s) => s.kind === "CLINICAL").length,
  })));

  return (
    <div className="space-y-6">
      <PageHeader
        crumb={{ href: `/programs/${program.id}`, label: program.name }}
        title={<>{offering.name} <span className={`ml-2 align-middle rounded-full px-2.5 py-0.5 text-xs font-medium ${PHASE_BADGE[timing.phase]}`}>{PHASE_LABEL[timing.phase]}</span></>}
        lede={timing.phase === "in-program" && timing.currentTermName ? <>Now in {timing.currentTermName}, week {(timing.weeksElapsed ?? 0) + 1} of {timing.totalWeeks}. Last day {exactDate(lastDay ?? timing.endDate)}.</>
          : timing.phase === "recruiting" ? <>Starts {exactDate(offering.startDate ?? timing.startDate)} and runs {timing.totalWeeks} weeks. Last day {exactDate(lastDay ?? timing.endDate)}.</>
          : timing.phase === "graduated" ? <>Ran {exactDate(offering.startDate ?? timing.startDate)} to {exactDate(lastDay ?? timing.endDate)}.</>
          : <>No start date yet.</>}
        meta={[offering.campus ? `Meets at ${offering.campus.name}${offering.locationNote && offering.locationNote !== offering.campus.name ? `, ${offering.locationNote}` : ""}` : offering.locationNote ? `Meets at ${offering.locationNote}` : null, offering.code ? `College reference ${offering.code}` : null, program.calendarMode === "continuous" ? "runs straight through, across semesters" : null].filter(Boolean).join(" · ") || undefined}
        actions={<>
          <a href={`/api/offerings/${offering.id}/rotations`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" title="every clinical course's rotation schedule as a workbook">Rotations ↓</a>
          <Link href={`/programs/${program.id}/offerings/${offering.id}/design`} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Design &amp; sequence →</Link>
        </>}
      />

      {/* Where this offering's dates come from (Phase 3): provisional until the college calendar is imported and the terms are taken from it. */}
      <ProvisionalDatesBanner provenance={{
        calendarImported: (program.institution?.academicEvents ?? []).some((e) => e.kind === "term_start"),
        termsTotal: offering.cohortTerms.length,
        termsFromCalendar: offering.cohortTerms.filter((ct) => ct.source === "calendar").length,
        termsHandSet: offering.cohortTerms.filter((ct) => ct.source === "chosen" || ct.source === "manual").length,
        termsPattern: offering.cohortTerms.filter((ct) => !ct.source || ct.source === "pattern" || ct.source === "template").length,
      }} />

      {/* Counts + timing */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="Starts" value={offering.startDate ? dateFmt(offering.startDate) : "—"} />
        <Tile label="Last day" value={exactDate(lastDay ?? timing.endDate)} sub={timing.phase === "in-program" ? `now in ${timing.currentTermName ?? "—"}` : undefined} />
        <Tile label="Goal" value={fmt.num(offering.stages.find((s) => s.stageKey === "productive")?.targetNumber ?? 0)} sub="fully productive workers" />
        <Tile label="Students" value={fmt.num(enrolledNow)} sub={ledger && ledger.students.some((s) => s.status === "withdrawn") ? (() => { const o = outcomeStats(ledger.students); return `${fmt.num(o.withdrawn)} withdrawn · ${fmt.pct(o.withdrawalRate)} of ${fmt.num(o.entrants)} who started`; })() : undefined} />
      </div>

      {/* Where it meets — a planning decision (campus, building or room, the college's own reference) */}
      <form action={updateOfferingLocation.bind(null, offering.id, program.id)} className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Where it meets</span>
        <label className="block"><span className="mb-0.5 block text-[10px] text-slate-400">Campus / center</span><select name="campusId" defaultValue={offering.campusId ?? ""} className="rounded-lg border border-slate-300 px-2 py-1 text-sm"><option value="">— not set —</option>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city && !c.name.includes(c.city) ? ` · ${c.city}` : ""}</option>)}</select></label>
        <label className="block"><span className="mb-0.5 block text-[10px] text-slate-400">Building / room</span><input name="locationNote" defaultValue={offering.locationNote ?? ""} placeholder="e.g. Bullock Bldg, Rm 173" className="w-52 rounded-lg border border-slate-300 px-2 py-1 text-sm" /></label>
        <label className="block"><span className="mb-0.5 block text-[10px] text-slate-400">College reference</span><input name="code" defaultValue={offering.code ?? ""} placeholder="section no." className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm" /></label>
        <button className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">Save</button>
      </form>

      {/* This run's funnel — right under the timing tiles */}
      {offering.stages.length > 0 && (
        <Collapse
          title="Talent pipeline"
          sub="Goal and actual at each stage"
          summary={<>{fmt.num(offering.stages.find((s) => s.stageKey === "productive")?.targetNumber ?? 0)} productive target · {fmt.num(enrolledNow)} enrolled now</>}
        >
          <div className="mb-4">
            <OfferingPipelineEditor cohortId={offering.id} initial={initialTargets} termNames={orderedTerms.map((t) => t.name)} defaultRates={defaultRates} />
          </div>
          <FunnelChart
            programId={program.id}
            stages={offering.stages.map((s) => ({ key: s.stageKey as StageKey, label: s.label, target: s.targetNumber, actual: s.actualNumber }))}
            termEnrollment={termEnrollment}
          />
        </Collapse>
      )}

      {/* ── One button: rooms, sites, staff and learners, all placed — the operational module only (Phase 13) ── */}
      {OPERATIONAL && (
        <AutoAssignButton cohortId={offering.id} programId={program.id} meetings={offering._count.meetings} staffedShifts={offering._count.sessionStaff} studentShifts={offering._count.studentShifts} students={enrolledNow} />
      )}

      {/* ── Term dates for THIS offering (derived from the org's calendar; overridable here) ── */}
      {(() => {
        const inst = program.institution;
        const isoD = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
        const events = inst.academicEvents.map((e) => ({ iso: isoD(e.date)!, endIso: isoD(e.endDate), label: e.label, kind: e.kind, season: e.season }));
        const codedStarts = events.filter((e) => e.kind === "term_start").length;
        // The same engine that set these dates, run again here only to explain them (labels, warnings).
        const preview = offering.startDate ? alignOffering({
          startIso: isoD(offering.startDate)!,
          terms: orderedTerms.map((t) => ({ id: t.id, index: t.index, name: t.name, semester: t.semester, startWeek: t.startWeek, endWeek: t.endWeek })),
          courses: orderedTerms.flatMap((t) => t.courses.map((c) => ({ id: c.id, code: c.code, name: c.name, termId: t.id, sessions: c.sessions }))),
          anchors: { springStart: inst.springStart, summerStart: inst.summerStart, fallStart: inst.fallStart },
          events,
          manual: Object.fromEntries(offering.cohortTerms.filter((ct) => ct.source === "manual" && ct.startDate).map((ct) => [ct.termId, { startIso: isoD(ct.startDate)!, endIso: isoD(ct.endDate) }])),
          calendarMode: program.calendarMode === "continuous" ? "continuous" : "semester",
        }) : null;
        const ctByTerm = new Map(offering.cohortTerms.map((ct) => [ct.termId, ct]));
        const SRC_TONE: Record<string, string> = { calendar: "bg-emerald-100 text-emerald-800", pattern: "bg-sky-100 text-sky-800", template: "bg-slate-100 text-slate-600", chosen: "bg-slate-100 text-slate-600", manual: "bg-amber-100 text-amber-800" };
        const autoWindows = offering.courseDates.filter((cd) => cd.auto).length;
        const typedWindows = offering.courseDates.length - autoWindows;
        return (
          <Collapse
            title="Term dates"
            sub={program.calendarMode === "continuous" ? "Straight through from the first day, across semesters" : codedStarts ? `From ${inst.name}'s academic calendar` : `From ${inst.name}'s semester pattern`}
            summary={<>{offering.startDate ? dateFmt(offering.startDate) : "no start"} → {exactDate(lastDay ?? timing.endDate)} · {orderedTerms.length} terms{typedWindows ? ` · ${typedWindows} typed` : ""}</>}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                  <tr><th className="px-2 py-1.5 text-left">Term</th><th className="px-2 py-1.5 text-left">Semester</th><th className="px-2 py-1.5 text-left">First day</th><th className="px-2 py-1.5 text-left">Last day</th><th className="px-2 py-1.5 text-left">Weeks</th><th className="px-2 py-1.5 text-left">Source</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orderedTerms.map((t) => {
                    const ct = ctByTerm.get(t.id); const pv = preview?.terms.find((x) => x.termId === t.id);
                    const src = (ct?.source ?? pv?.startSource ?? "template") as DateSource;
                    const tplWeeks = (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1;
                    // Semester and weeks read from the STORED dates (the source of truth the calendar and
                    // every chart use) — the preview only explains where they came from.
                    const semester = ct?.startDate ? `${seasonOfTerm({ semester: ct.semester, name: t.name }, ct.startDate) ?? ""} ${ct.startDate.getUTCFullYear()}`.trim() : pv?.semester ?? "—";
                    const calWeeks = ct?.startDate && ct?.endDate ? calendarWeeksBetween(ct.startDate, ct.endDate) : pv?.calendarWeeks ?? tplWeeks;
                    return (
                      <tr key={t.id}>
                        <td className="px-2 py-1.5 font-medium text-slate-800">{t.name}</td>
                        <td className="px-2 py-1.5 text-slate-600">{semester}</td>
                        <td className="px-2 py-1.5 tabular-nums text-slate-800">{exactDate(ct?.startDate ?? null)}</td>
                        <td className="px-2 py-1.5 tabular-nums text-slate-800">{exactDate(ct?.endDate ?? null)}</td>
                        <td className="px-2 py-1.5 tabular-nums text-slate-600">{calWeeks === tplWeeks ? `${tplWeeks}` : <span className={calWeeks < tplWeeks ? "text-amber-700" : "text-slate-600"} title={`the template plans ${tplWeeks} weeks; the semester gives ${calWeeks}`}>{calWeeks} <span className="text-[10px] text-slate-400">(template {tplWeeks})</span></span>}</td>
                        <td className="px-2 py-1.5 text-xs">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SRC_TONE[src] ?? SRC_TONE.template}`} title={pv?.startLabel && src !== "manual" ? `${pv.startLabel}${pv.endLabel ? ` → ${pv.endLabel}` : ""}` : undefined}>{SOURCE_LABEL[src] ?? src}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(() => {
              // Week warnings from the stored dates; the preview's other warnings (a moved start) still apply.
              const stored = orderedTerms.flatMap((t) => { const ct = ctByTerm.get(t.id); if (!ct?.startDate || !ct.endDate) return []; const tpl = (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1; const cal = calendarWeeksBetween(ct.startDate, ct.endDate); return cal < tpl ? [`${t.name}: the template plans ${tpl} weeks but ${seasonOfTerm({ semester: ct.semester, name: t.name }, ct.startDate)} ${ct.startDate.getUTCFullYear()} gives only ${cal} (${dateFmt(ct.startDate)} → ${dateFmt(ct.endDate)}); its sessions are fitted into those ${cal} weeks, in order.`] : []; });
              const other = (preview?.warnings ?? []).filter((w) => !/template plans/.test(w));
              const all = [...other, ...stored];
              return all.length > 0 ? <ul className="mt-2 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">{all.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul> : null;
            })()}
            {preview && preview.courses.length > 0 && (
              <details className="mt-2 text-xs text-slate-500">
                <summary className="cursor-pointer">{preview.courses.length} shorter course{preview.courses.length === 1 ? " has its" : "s have their"} own window</summary>
                <p className="mt-1">{preview.courses.map((c) => `${c.code ?? c.name} ${dateFmt(new Date(c.startIso + "T00:00:00Z"))} → ${dateFmt(new Date(c.endIso + "T00:00:00Z"))}`).join(" · ")}. Type a course&apos;s own dates on its card under Course sequence to override.</p>
              </details>
            )}

            {(OPERATIONAL || offering.status === "planned") && <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-slate-600">Set dates by hand, or move the start and re-align</summary>
              <form action={updateOfferingDates.bind(null, offering.id, program.id)} className="mt-2 flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Offering start</span>
                  <input key={`start-${iso(offering.startDate)}`} type="date" name="startDate" defaultValue={iso(offering.startDate)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
                </label>
                {orderedTerms.map((t) => {
                  const ct = ctByTerm.get(t.id);
                  return (
                    <span key={t.id} className="flex items-end gap-1">
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t.name} first day</span>
                        <input key={`${t.id}-${iso(ct?.startDate)}`} type="date" name={`term_${t.id}`} defaultValue="" placeholder={iso(ct?.startDate)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">last day</span>
                        <input key={`${t.id}-end-${iso(ct?.endDate)}`} type="date" name={`term_end_${t.id}`} defaultValue="" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
                      </label>
                    </span>
                  );
                })}
                <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700" title="terms you type here stay as typed; everything else keeps following the calendar around them">Save typed dates</button>
                <button name="rederive" value="1" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" title="drop every typed date and put every term back on the academic calendar from the offering start">Re-align to the organization&apos;s calendar</button>
              </form>
              <p className="mt-1 text-[11px] text-slate-400">Leave a term blank to keep it on the calendar.</p>
            </details>}
          </Collapse>
        );
      })()}

      {beyondByTerm.size > 0 && (
        <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200">
          ⚠ <strong>{[...beyondByTerm.values()].reduce((n, b) => n + b.sessions, 0)} shifts fall after their term ends</strong> ({[...beyondByTerm.entries()].map(([term, b]) => `${term}: template weeks ${Math.min(...b.weeks)}–${Math.max(...b.weeks)}`).join(" · ")}). Move or drop them under{" "}
          <Link href={`/programs/${program.id}/offerings/${offering.id}/design`} className="font-medium underline">Design &amp; sequence</Link>.
        </div>
      )}

      {holidayMoved > 0 && (
        <p className="rounded-lg bg-slate-50 px-4 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
          {fmt.num(holidayMoved)} session{holidayMoved === 1 ? "" : "s"} moved off a holiday by the college&apos;s holiday rule. The design page marks each one.
        </p>
      )}
      {holidayHits > 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          ⚠ <strong>{holidayHits} session{holidayHits === 1 ? " lands" : "s land"} on a holiday the rule could not resolve.</strong> Move {holidayHits === 1 ? "it" : "them"} under{" "}
          <Link href={`/programs/${program.id}/offerings/${offering.id}/design`} className="font-medium underline">Design &amp; sequence</Link>.
        </div>
      )}

      {/* ── Preferred course sequence (template-wide) ──────────────────────── */}
      <Collapse
        title="Course sequence"
        sub="Which course runs in which term"
        summary={<>{seqCourses.length} courses · {seqTerms.length} terms</>}
      >
        <CourseSequencer
          programId={program.id} terms={seqTerms} initialCourses={seqCourses}
          cohortId={offering.id}
          courseDates={Object.fromEntries(offering.courseDates.map((cd) => [cd.courseId, { start: iso(cd.startDate) || null, end: iso(cd.endDate) || null, auto: cd.auto }]))}
        />
      </Collapse>

      {/* ── Staffing: how many instructors & preceptors, when — and who covers each shift ── */}
      {(staffing || capCohort) && (
        <Collapse
          title="Staffing"
          sub="Instructors and preceptors needed, and who covers each session"
          summary={<><span className="text-emerald-700">{fmt.atLeast(peakFac)} instructors</span> · <span className="text-amber-700">{fmt.atLeast(peakPre)} preceptors</span> at the peak week{staffing ? <> · {staffing.loads.length} people assigned · {fmt.hours(staffing.assignments.reduce((n, a) => n + a.contactHours, 0))} contact h</> : null}</>}
        >
          <div className="space-y-6">
            {capCohort && (
              <div>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">How many, and when</div>
                <CapacityBoard cohorts={[capCohort]} view="staffing" sites={sites} assignments={staffing?.assignments ?? []} />
              </div>
            )}
            {staffing && (
              <div>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Who covers this run</div>
                <ReadOnly what="Who covers this run"><OfferingStaffing cohortId={offering.id} programId={program.id} enrolled={staffing.enrolled}
                  terms={staffing.program.terms.map((t) => ({ id: t.id, name: t.name, courses: t.courses.map((c) => ({ id: c.id, code: c.code, name: c.name, sessions: c.sessions })) }))}
                  assignments={staffing.assignments} people={staffing.people} loads={staffing.loads} /></ReadOnly>
              </div>
            )}
          </div>
        </Collapse>
      )}

      {/* ── Clinical rotations: who is in which setting at which site, week by week ── */}
      {/* ── Completion requirements: where every student stands, and what the cohort still needs from which sites ── */}
      {reqProgress && reqProgress.sets.length > 0 && (
        <div id="requirements" className="scroll-mt-16">
          <Collapse
            title="Completion requirements"
            sub={`${reqProgress.sets.map((x) => x.authority.split(" · ")[0]).join(" · ")}: where each student stands`}
            summary={<>{reqProgress.sets.map((x) => `${x.complete} of ${reqProgress.students} complete`).join(" · ")}{reqProgress.sets.some((x) => !x.verified) && <> <UnverifiedStandard verified={false} size="xs" /></>}</>}
          >
            <CohortRequirementProgress data={reqProgress} base={`/programs/${program.id}/offerings/${params.cohortId}`} />
          </Collapse>
        </div>
      )}

      {rotations && rotations.courses.length > 0 && (
        <div id="rotations">
          <Collapse
            title="Clinical rotations"
            sub="Who is at which site, week by week"
            summary={rotations.plan ? <>{rotations.course?.code}: {rotations.plan.summary.placed} of {rotations.plan.summary.shifts} placed{rotations.plan.summary.studentsShort > 0 ? <> · <span className="text-rose-600">{rotations.plan.summary.studentsShort} short</span></> : <> · <span className="text-emerald-700">all hours reachable</span></>}{rotations.plan.bottlenecks.length > 0 ? <> · <span className="text-amber-700">{rotations.plan.bottlenecks.length} bottlenecks</span></> : null}</> : <>{rotations.courses.length} clinical course{rotations.courses.length === 1 ? "" : "s"} · no plan built yet</>}
            defaultOpen={!!searchParams?.course}
          >
            <ReadOnly what="The rotation plan"><RotationBoard data={rotations} programId={program.id} /></ReadOnly>
          </Collapse>
        </div>
      )}

      {/* ── The learners: sections, instructors, preceptors and the clinical hours ledger ── */}
      {ledger && ledger.students.length > 0 && (() => {
        const active = ledger.students.filter((s) => s.status !== "withdrawn");
        const short = active.filter((s) => s.shortHours > 0).length;
        const unpre = active.filter((s) => s.unprecepted > 0).length;
        const logged = active.reduce((n, s) => n + s.loggedHours, 0);
        const required = active.reduce((n, s) => n + s.requiredHours, 0);
        return (
          <Collapse
            title="Students"
            sub="Sections, preceptors and clinical hours logged"
            summary={<>{active.length} enrolled · <span className="text-emerald-700">{n1(logged)} of {n1(required)} h logged</span>{short > 0 ? <> · <span className="text-rose-600">{short} short</span></> : null}{unpre > 0 ? <> · <span className="text-amber-700">{unpre} unprecepted</span></> : null}</>}
          >
            <ReadOnly what="The shift ledger"><OfferingLedger ledger={ledger} programId={program.id} /></ReadOnly>
          </Collapse>
        );
      })()}

      {/* ── THE calendar for this offering: exact dates, times, locations ── */}
      {capCohort && (
        <Collapse
          title="Calendar"
          sub="Every date, time and place"
          summary={<>{exactDate(offering.startDate ?? timing.startDate)} → {exactDate(lastDay ?? timing.endDate)}</>}
        >
          <CapacityBoard cohorts={[capCohort]} view="coverage" sites={sites} rooms={capModel?.rooms ?? []} people={capModel?.people ?? []} />
        </Collapse>
      )}

    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}
