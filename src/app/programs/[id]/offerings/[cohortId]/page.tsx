import Link from "next/link";
import { notFound } from "next/navigation";
import { getOffering, getCapacityModel } from "@/lib/queries";
import { updateOfferingDates, saveCourseDates } from "@/lib/actions";
import { FunnelChart } from "@/components/FunnelChart";
import { CourseSequencer, type SeqCourse, type SeqTerm } from "@/components/CourseSequencer";
import { fmt } from "@/lib/format";
import type { StageKey } from "@/lib/funnel";
import { computeCohortTiming, type TimingTerm } from "@/lib/term";
import { buildInstances, lastSessionDate, weeklyNeedByKind, type CohortCalendarInput } from "@/lib/capacitymodel";
import { CapacityBoard } from "@/components/CapacityBoard";
import { Collapse } from "@/components/Collapse";

export const dynamic = "force-dynamic";

const dateFmt = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");

const STATUS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700", planned: "bg-sky-100 text-sky-700",
  completed: "bg-slate-200 text-slate-600", archived: "bg-slate-100 text-slate-400",
};
const PHASE_LABEL: Record<string, string> = { recruiting: "Recruiting", "in-program": "In program", graduated: "Graduated", unscheduled: "Unscheduled" };
const PHASE_BADGE: Record<string, string> = {
  recruiting: "bg-sky-100 text-sky-700", "in-program": "bg-emerald-100 text-emerald-700",
  graduated: "bg-slate-200 text-slate-600", unscheduled: "bg-slate-100 text-slate-400",
};
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1 });

export default async function OfferingPage({ params }: { params: { id: string; cohortId: string } }) {
  const offering = await getOffering(params.cohortId);
  if (!offering || offering.programId !== params.id) notFound();
  const program = offering.program;
  const capModel = await getCapacityModel();

  // Real date per template term for THIS offering.
  const termDate = new Map(offering.cohortTerms.map((ct) => [ct.termId, ct.startDate]));

  const today = new Date();
  const orderedTerms = [...program.terms].sort((a, b) => a.index - b.index);
  const timingTerms: TimingTerm[] = orderedTerms.map((t) => ({ index: t.index, name: t.name, startWeek: t.startWeek, endWeek: t.endWeek }));
  const realTermStarts = orderedTerms.map((t) => termDate.get(t.id) ?? null);
  const timing = computeCohortTiming(offering.startDate ?? null, timingTerms, today, realTermStarts);
  const monthYear = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—");
  const exactDate = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

  // ── Real end date + holiday collisions for THIS instantiation (same engine
  //    as the Insights tabs; the full breakdown lives in the sections below). ──
  const capCohort = capModel?.cohorts.find((c) => c.cohortId === offering.id) ?? null;
  const sites = capModel?.clinicalSites ?? [];
  let lastDay: Date | null = null;
  let holidayHits = 0;
  let peakFac = 0;
  let peakPre = 0;
  if (capCohort) {
    const input: CohortCalendarInput = {
      cohortId: capCohort.cohortId, cohort: capCohort.cohort, programId: capCohort.programId, program: capCohort.program,
      enrollmentByTerm: capCohort.enrollmentByTerm,
      termStartByIndex: Object.fromEntries(Object.entries(capCohort.termStartByIndex as Record<string, string | null>).map(([k, v]) => [k, v ? new Date(v) : null])),
      holidays: capCohort.holidays,
      courses: capCohort.courses,
    };
    const instances = buildInstances(input, capCohort.assumptions).filter((i) => i.mondayIso != null);
    lastDay = lastSessionDate(instances);
    holidayHits = instances.filter((i) => i.holiday).length;
    const w = weeklyNeedByKind(instances);
    peakFac = Math.max(0, ...w.map((x) => x.totalFacFte));
    peakPre = Math.max(0, ...w.map((x) => x.preceptorFte));
  }

  // Enrollment through each term — target ladder from the pipeline, rendered
  // inside the funnel under "Enrolled" so the whole journey reads top to bottom.
  const termEnrollment = capCohort
    ? orderedTerms.map((t) => ({
        label: `${t.name}`,
        target: capCohort.enrollmentByTerm[t.index] ?? 0,
        actual: timing.phase === "in-program" && timing.currentTermName === t.name ? offering._count.students : null,
        current: timing.phase === "in-program" && timing.currentTermName === t.name,
      }))
    : [];

  // Sequence board inputs (template-wide; re-sequencing moves every offering).
  const seqTerms: SeqTerm[] = orderedTerms.map((t) => ({ id: t.id, name: t.name, courseCount: t.courses.length }));
  const seqCourses: SeqCourse[] = orderedTerms.flatMap((t) => t.courses.map((c) => ({
    id: c.id, code: c.code, name: c.name, termId: t.id, requisites: c.requisites,
    classCount: c.sessions.filter((s) => s.kind === "CLASS").length,
    labCount: c.sessions.filter((s) => s.kind === "LAB").length,
    clinicalCount: c.sessions.filter((s) => s.kind === "CLINICAL").length,
  })));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <Link href={`/programs/${program.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {program.name} template</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{offering.name}</h1>
            <p className="text-sm text-slate-500">
              A scheduled offering of <Link href={`/programs/${program.id}`} className="text-rose-700 hover:underline">{program.name}</Link> · {program.institution.name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${PHASE_BADGE[timing.phase]}`}>{PHASE_LABEL[timing.phase]}</span>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS[offering.status] ?? "bg-slate-100 text-slate-600"}`}>{offering.status}</span>
          </div>
        </div>
        {timing.phase === "in-program" && timing.currentTermName && (
          <p className="mt-1 text-sm text-emerald-700">
            Now in <strong>{timing.currentTermName}</strong> · week {(timing.weeksElapsed ?? 0) + 1} of {timing.totalWeeks} · last day {exactDate(lastDay ?? timing.endDate)}
          </p>
        )}
        {timing.phase === "recruiting" && (
          <p className="mt-1 text-sm text-sky-700">Starts {exactDate(offering.startDate ?? timing.startDate)} · runs {timing.totalWeeks} weeks · last day of class / lab / clinical: <strong>{exactDate(lastDay ?? timing.endDate)}</strong></p>
        )}
        {timing.phase === "graduated" && (
          <p className="mt-1 text-sm text-slate-500">Ran {exactDate(offering.startDate ?? timing.startDate)} – {exactDate(lastDay ?? timing.endDate)} · completed</p>
        )}
      </div>

      {/* Counts + timing */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Starts" value={offering.startDate ? dateFmt(offering.startDate) : "—"} />
        <Tile label="Current term" value={timing.phase === "in-program" ? (timing.currentTermName ?? "—") : "—"} sub={timing.phase === "in-program" ? `week ${(timing.weeksElapsed ?? 0) + 1} of ${timing.totalWeeks}` : PHASE_LABEL[timing.phase].toLowerCase()} />
        <Tile label="Expected end" value={exactDate(lastDay ?? timing.endDate)} sub="last class / lab / clinical / exam" />
        <Tile label="Scheduled terms" value={`${offering.cohortTerms.length} / ${program.terms.length}`} sub="dated of template" />
        <Tile label="Students" value={fmt.num(offering._count.students)} />
      </div>

      {/* This run's funnel — right under the timing tiles */}
      {offering.stages.length > 0 && (
        <Collapse
          title="Talent pipeline"
          sub="Goal vs actual at every stage — with enrollment through each term of the program"
          summary={<>{fmt.num(offering.stages.find((s) => s.stageKey === "productive")?.targetNumber ?? 0)} productive target · {fmt.num(offering._count.students)} enrolled now</>}
          defaultOpen
        >
          <FunnelChart
            programId={program.id}
            stages={offering.stages.map((s) => ({ key: s.stageKey as StageKey, label: s.label, target: s.targetNumber, actual: s.actualNumber }))}
            termEnrollment={termEnrollment}
          />
        </Collapse>
      )}

      {/* Design & sequence for THIS instantiation */}
      <Link href={`/programs/${program.id}/offerings/${offering.id}/design`} className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50/40 px-4 py-3 hover:border-rose-300 hover:bg-rose-50/70">
        <div>
          <div className="text-sm font-semibold text-slate-800">Design &amp; sequence — this offering ↦</div>
          <div className="text-xs text-slate-500">
            Every session of every course with its real date, time, location and instructor / preceptor — configure this
            instantiation without touching the boilerplate template.
          </div>
        </div>
        <span className="text-rose-600">→</span>
      </Link>

      {/* ── Offering setup: adjust the real dates ─────────────────────────── */}
      <Collapse
        title="Offering dates"
        sub="The start date and each term's first day — change them and the calendar, staffing and every insight re-derive"
        summary={<>{offering.startDate ? dateFmt(offering.startDate) : "no start"} → {exactDate(lastDay ?? timing.endDate)}</>}
      >
        <form action={updateOfferingDates.bind(null, offering.id, program.id)} className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Offering start</span>
            {/* keyed by value so a re-derive shows the new dates without a reload */}
            <input key={`start-${iso(offering.startDate)}`} type="date" name="startDate" defaultValue={iso(offering.startDate)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
          {orderedTerms.map((t) => (
            <label key={t.id} className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t.name} starts</span>
              <input key={`${t.id}-${iso(termDate.get(t.id) ?? null)}`} type="date" name={`term_${t.id}`} defaultValue={iso(termDate.get(t.id) ?? null)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
            </label>
          ))}
          <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Save dates</button>
          <button name="rederive" value="1" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" title="keep the offering start; re-derive every term's first day along the institution's academic calendar (Spring / Summer / Fall anchors set on the goal page)">Save &amp; re-derive terms from start</button>
        </form>
      </Collapse>

      {holidayHits > 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          ⚠ <strong>{holidayHits} session{holidayHits === 1 ? " lands" : "s land"} on an observed holiday.</strong> Open{" "}
          <Link href={`/programs/${program.id}/offerings/${offering.id}/design`} className="font-medium underline">Design &amp; sequence — this offering</Link>{" "}
          — flagged rows show which holiday; click a row to move that session for this offering.
        </div>
      )}

      {/* ── Preferred course sequence (template-wide) ──────────────────────── */}
      <Collapse
        title="Preferred course sequence"
        sub="Drag courses between terms; set each course's real start & end dates for THIS offering on its card"
        summary={<>{seqCourses.length} courses · {seqTerms.length} terms</>}
      >
        <CourseSequencer
          programId={program.id} terms={seqTerms} initialCourses={seqCourses}
          cohortId={offering.id}
          courseDates={Object.fromEntries(offering.courseDates.map((cd) => [cd.courseId, { start: iso(cd.startDate) || null, end: iso(cd.endDate) || null }]))}
        />
      </Collapse>

      {/* ── Week-by-week / day-by-day staffing for THIS instantiation ── */}
      {capCohort && (
        <Collapse
          title="Instructors & preceptors"
          sub="How many, and when — semester, week and day views: FTE charts and every shift with who staffs it"
          summary={<><span className="text-emerald-700">{Math.ceil(peakFac - 1e-9)} instructors</span> · <span className="text-amber-700">{Math.ceil(peakPre - 1e-9)} preceptors</span> at the peak week</>}
        >
          <CapacityBoard cohorts={[capCohort]} view="staffing" sites={sites} />
        </Collapse>
      )}

      {/* ── THE calendar for this instantiation: exact dates, times, locations ── */}
      {capCohort && (
        <Collapse
          title="Calendar"
          sub="Exact dates, times & locations at four altitudes — semester, month, week, day; drag shifts between days, edit any shift's time, room/site and staff in the day view"
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
