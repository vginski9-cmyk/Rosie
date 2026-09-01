import Link from "next/link";
import { notFound } from "next/navigation";
import { getOffering, getCapacityModel } from "@/lib/queries";
import { updateOfferingDates, saveCourseDates } from "@/lib/actions";
import { FunnelChart } from "@/components/FunnelChart";
import { CourseSequencer, type SeqCourse, type SeqTerm } from "@/components/CourseSequencer";
import { fmt } from "@/lib/format";
import type { StageKey } from "@/lib/funnel";
import { computeCohortTiming, type TimingTerm } from "@/lib/term";
import { buildInstances, weeklyNeed, settingAsks, lastSessionDate, type CohortCalendarInput } from "@/lib/capacitymodel";
import { CapacityBoard } from "@/components/CapacityBoard";

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

  // ── This instantiation's capacity math: instructors, preceptors, sites,
  //    and clinical supply vs demand — same engine as the Insights tabs. ──
  const capCohort = capModel?.cohorts.find((c) => c.cohortId === offering.id) ?? null;
  const sites = capModel?.clinicalSites ?? [];
  let lastDay: Date | null = null;
  let holidayHits = 0;
  let capacity: null | {
    peakFacFte: number; peakFacHeads: number; peakPreFte: number; peakPreHeads: number;
    asks: ReturnType<typeof settingAsks>;
    peakDayStudents: number; peakDayIso: string | null; supply: number; activeSites: number; gap: number;
  } = null;
  if (capCohort) {
    const input: CohortCalendarInput = {
      cohortId: capCohort.cohortId, cohort: capCohort.cohort, programId: capCohort.programId, program: capCohort.program,
      enrollmentByTerm: capCohort.enrollmentByTerm,
      termStartByIndex: Object.fromEntries(Object.entries(capCohort.termStartByIndex).map(([k, v]) => [k, v ? new Date(v) : null])),
      courses: capCohort.courses,
    };
    const instances = buildInstances(input, capCohort.assumptions).filter((i) => i.mondayIso != null);
    const weekly = weeklyNeed(instances);
    const peakFacFte = Math.max(0, ...weekly.map((w) => w.facultyFte));
    const peakPreFte = Math.max(0, ...weekly.map((w) => w.preceptorFte));
    const clinical = instances.filter((i) => i.session.kind === "CLINICAL");
    const byDate = new Map<string, number>();
    for (const r of clinical) {
      if (!r.dateIso) continue;
      const students = Math.min(r.computed.C, (r.computed.Y ?? 0) * (r.session.maxStudents ?? 0));
      byDate.set(r.dateIso, (byDate.get(r.dateIso) ?? 0) + students);
    }
    let peakDayStudents = 0; let peakDayIso: string | null = null;
    for (const [k, v] of byDate) if (v > peakDayStudents) { peakDayStudents = v; peakDayIso = k; }
    const activeSitesList = sites.filter((x) => x.status === "active");
    const supply = activeSitesList.reduce((n, x) => n + (x.wblSlots ?? 0), 0);
    lastDay = lastSessionDate(instances);
    holidayHits = instances.filter((i) => i.holiday).length;
    capacity = {
      peakFacFte, peakFacHeads: Math.ceil(peakFacFte - 1e-9),
      peakPreFte, peakPreHeads: Math.ceil(peakPreFte - 1e-9),
      asks: settingAsks(instances),
      peakDayStudents, peakDayIso, supply, activeSites: activeSitesList.length,
      gap: supply - peakDayStudents,
    };
  }

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
      <section className="card card-pad space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Offering dates — adjust so everything lines up</h2>
          <p className="text-sm text-slate-500">
            The start date and each term&apos;s first day are this offering&apos;s reality. Change them and the calendar,
            staffing needs, clinical demand, and every insight shift with them. Class start <em>times</em> are set per
            meeting in the schedule below.
          </p>
        </div>
        <form action={updateOfferingDates.bind(null, offering.id, program.id)} className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Offering start</span>
            <input type="date" name="startDate" defaultValue={iso(offering.startDate)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
          {orderedTerms.map((t) => (
            <label key={t.id} className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t.name} starts</span>
              <input type="date" name={`term_${t.id}`} defaultValue={iso(termDate.get(t.id) ?? null)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
            </label>
          ))}
          <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Save dates</button>
        </form>
      </section>

      {holidayHits > 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          ⚠ <strong>{holidayHits} session{holidayHits === 1 ? " lands" : "s land"} on an observed holiday.</strong> Open{" "}
          <Link href={`/programs/${program.id}/offerings/${offering.id}/design`} className="font-medium underline">Design &amp; sequence — this offering</Link>{" "}
          — flagged rows show which holiday; click a row to move that session for this offering.
        </div>
      )}

      {/* ── What this instantiation needs ─────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">What this instantiation needs — instructors, preceptors &amp; clinical sites</h2>
          <p className="text-sm text-slate-500">
            Computed live from the session table at this offering&apos;s enrollment targets and real dates — the same math as
            the <Link href="/insights/staffing-need" className="text-rose-700 hover:underline">Insights</Link> tabs, scoped to this run.
          </p>
        </div>
        {capacity ? (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Tile label="Instructors (peak week)" value={String(capacity.peakFacHeads)} sub={`${n1(capacity.peakFacFte)} FTE at the heaviest week`} />
              <Tile label="Preceptors (peak week)" value={String(capacity.peakPreHeads)} sub={`${n1(capacity.peakPreFte)} FTE at the heaviest week`} />
              <Tile label="Clinical settings needed" value={String(capacity.asks.length)} sub={capacity.asks.map((a) => a.setting).join(" · ") || "no clinical demand"} />
              <div className={`rounded-xl border p-5 ${capacity.asks.length === 0 ? "border-slate-200 bg-white" : capacity.supply === 0 ? "border-rose-200 bg-rose-50/50" : capacity.gap >= 0 ? "border-emerald-200 bg-emerald-50/50" : "border-rose-200 bg-rose-50/50"}`}>
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Clinical supply vs demand</div>
                <div className={`mt-1 text-2xl font-semibold tabular-nums ${capacity.asks.length === 0 ? "text-slate-400" : capacity.supply === 0 || capacity.gap < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                  {capacity.asks.length === 0 ? "—" : capacity.supply === 0 ? "no supply" : capacity.gap >= 0 ? `fits (+${Math.round(capacity.gap)})` : `short by ${Math.round(-capacity.gap)}`}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  peak day {Math.round(capacity.peakDayStudents)} students on site · {capacity.activeSites} active site{capacity.activeSites === 1 ? "" : "s"} supply {Math.round(capacity.supply)}/day ·{" "}
                  <Link href="/insights/clinical-sites" className="text-rose-700 hover:underline">full picture ↦</Link>
                </div>
              </div>
            </div>
            {capacity.asks.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2 font-semibold">Clinical setting</th>
                      <th className="px-3 py-2 text-right font-semibold">Students on peak day</th>
                      <th className="px-3 py-2 text-right font-semibold">Hosted shifts</th>
                      <th className="px-3 py-2 text-right font-semibold">Preceptor hours</th>
                      <th className="px-3 py-2 text-right font-semibold">Peak-week preceptor FTE</th>
                      <th className="px-3 py-2 font-semibold">Days</th>
                      <th className="px-3 py-2 font-semibold">Window</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capacity.asks.map((a) => (
                      <tr key={a.setting} className="border-b border-slate-100">
                        <td className="px-3 py-1.5 font-medium text-slate-800">{a.setting}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{Math.round(a.studentPeakDay)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{Math.round(a.sectionsTotal)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{Math.round(a.preceptorHours)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{n1(a.preceptorPeakWeekFte)}</td>
                        <td className="px-3 py-1.5 text-slate-500">{a.days.join(" · ") || "—"}</td>
                        <td className="px-3 py-1.5 text-slate-500">{a.firstIso ? `${a.firstIso} → ${a.lastIso ?? ""}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-400">Capacity math appears once the offering has term dates.</p>
        )}
      </section>

      {/* ── Preferred course sequence (template-wide) ──────────────────────── */}
      <section className="card card-pad space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Preferred course sequence</h2>
          <p className="text-sm text-slate-500">
            Which course sits in which term — drag to re-sequence (template-wide). On each card, set the course&apos;s
            <strong> real start and end dates for THIS offering</strong> — an 8-week course inside a 16-week term gets its
            own window, and session dates, the calendar, staffing and coverage all shift with it.
          </p>
        </div>
        <CourseSequencer
          programId={program.id} terms={seqTerms} initialCourses={seqCourses}
          cohortId={offering.id}
          courseDates={Object.fromEntries(offering.courseDates.map((cd) => [cd.courseId, { start: iso(cd.startDate) || null, end: iso(cd.endDate) || null }]))}
        />

      </section>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        <Link href={`/programs/${program.id}/students`} className="btn-primary">Students ↦</Link>
        {program.familyId && <Link href={`/families/${program.familyId}/wbl`} className="btn-primary">WBL design studio ↦</Link>}
      </div>

      {/* ── Week-by-week / day-by-day staffing for THIS instantiation ── */}
      {capCohort && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Instructors &amp; preceptors — how many, and when</h2>
            <p className="text-sm text-slate-500">
              This offering&apos;s need, week by week: class, lab and clinical faculty FTE (or raw contact hours) with the
              peaks called out and deadlines derived. Click any week for its day-by-day breakdown; the filters slice by
              term, course, session type, rotation, day, or date range.
            </p>
          </div>
          <CapacityBoard cohorts={[capCohort]} view="staffing" sites={sites} />
        </section>
      )}

      {/* ── THE calendar for this instantiation: exact dates, times, locations ── */}
      {capCohort && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Calendar — exact dates, times &amp; locations</h2>
            <p className="text-sm text-slate-500">
              Month view, color-coded <span className="font-medium text-sky-700">class</span> / <span className="font-medium text-violet-700">lab</span> / <span className="font-medium text-rose-700">clinical</span>.
              Every entry shows its time, students, and location; click a day for exactly what happens and the staffing it takes. Scroll months with ← →.
            </p>
          </div>
          <CapacityBoard cohorts={[capCohort]} view="coverage" sites={sites} />
        </section>
      )}

      {/* This run's funnel */}
      {offering.stages.length > 0 && (
        <section className="card card-pad space-y-1">
          <h2 className="text-lg font-semibold">Talent pipeline — {offering.name}</h2>
          <FunnelChart programId={program.id} stages={offering.stages.map((s) => ({ key: s.stageKey as StageKey, label: s.label, target: s.targetNumber, actual: s.actualNumber }))} />
        </section>
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
