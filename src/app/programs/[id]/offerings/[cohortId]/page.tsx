import Link from "next/link";
import { notFound } from "next/navigation";
import { getOffering, getCohortSchedule, getCapacityModel } from "@/lib/queries";
import { calendarizeCohort, updateOfferingDates } from "@/lib/actions";
import { FunnelChart } from "@/components/FunnelChart";
import { CohortSchedule } from "@/components/CohortSchedule";
import { CourseSequencer, type SeqCourse, type SeqTerm } from "@/components/CourseSequencer";
import { fmt } from "@/lib/format";
import type { StageKey } from "@/lib/funnel";
import { computeCohortTiming, type TimingTerm } from "@/lib/term";
import { buildInstances, weeklyNeed, settingAsks, type CohortCalendarInput } from "@/lib/capacitymodel";

export const dynamic = "force-dynamic";

const dateFmt = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const monthDay = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

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
  const [sched, capModel] = await Promise.all([
    getCohortSchedule(params.cohortId),
    getCapacityModel(),
  ]);

  // Real date per template term for THIS offering.
  const termDate = new Map(offering.cohortTerms.map((ct) => [ct.termId, ct.startDate]));

  const today = new Date();
  const orderedTerms = [...program.terms].sort((a, b) => a.index - b.index);
  const timingTerms: TimingTerm[] = orderedTerms.map((t) => ({ index: t.index, name: t.name, startWeek: t.startWeek, endWeek: t.endWeek }));
  const realTermStarts = orderedTerms.map((t) => termDate.get(t.id) ?? null);
  const timing = computeCohortTiming(offering.startDate ?? null, timingTerms, today, realTermStarts);
  const monthYear = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—");

  // ── This instantiation's capacity math: instructors, preceptors, sites,
  //    and clinical supply vs demand — same engine as the Insights tabs. ──
  const capCohort = capModel?.cohorts.find((c) => c.cohortId === offering.id) ?? null;
  const sites = capModel?.clinicalSites ?? [];
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
    capacity = {
      peakFacFte, peakFacHeads: Math.ceil(peakFacFte - 1e-9),
      peakPreFte, peakPreHeads: Math.ceil(peakPreFte - 1e-9),
      asks: settingAsks(instances),
      peakDayStudents, peakDayIso, supply, activeSites: activeSitesList.length,
      gap: supply - peakDayStudents,
    };
  }

  // ── Calendar timeline (the HTML model's "every cohort's terms and courses") ──
  const WK = 7 * 24 * 3600 * 1000;
  const termWindows = orderedTerms.map((t) => {
    const start = termDate.get(t.id) ?? null;
    const weeks = (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1;
    return { term: t, start, weeks, end: start ? new Date(start.getTime() + weeks * WK) : null };
  });
  const dated = termWindows.filter((w) => w.start != null) as { term: (typeof orderedTerms)[number]; start: Date; weeks: number; end: Date }[];
  const spanStart = dated.length ? Math.min(...dated.map((w) => w.start.getTime())) : null;
  const spanEnd = dated.length ? Math.max(...dated.map((w) => w.end.getTime())) : null;
  const pct = (ms: number) => (spanStart != null && spanEnd != null && spanEnd > spanStart ? ((ms - spanStart) / (spanEnd - spanStart)) * 100 : 0);
  const TERM_COLORS = ["bg-rose-500", "bg-sky-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500", "bg-cyan-500"];

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
            Now in <strong>{timing.currentTermName}</strong> · week {(timing.weeksElapsed ?? 0) + 1} of {timing.totalWeeks} · expected to finish {monthYear(timing.endDate)}
          </p>
        )}
        {timing.phase === "recruiting" && (
          <p className="mt-1 text-sm text-sky-700">Starts {monthYear(timing.startDate)} · runs {timing.totalWeeks} weeks · expected to finish {monthYear(timing.endDate)}</p>
        )}
        {timing.phase === "graduated" && (
          <p className="mt-1 text-sm text-slate-500">Ran {monthYear(timing.startDate)} – {monthYear(timing.endDate)} · completed</p>
        )}
      </div>

      {/* Counts + timing */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Starts" value={offering.startDate ? dateFmt(offering.startDate) : "—"} />
        <Tile label="Current term" value={timing.phase === "in-program" ? (timing.currentTermName ?? "—") : "—"} sub={timing.phase === "in-program" ? `week ${(timing.weeksElapsed ?? 0) + 1} of ${timing.totalWeeks}` : PHASE_LABEL[timing.phase].toLowerCase()} />
        <Tile label="Expected end" value={timing.endDate ? monthYear(timing.endDate) : "—"} sub={`${timing.totalWeeks}-week program`} />
        <Tile label="Scheduled terms" value={`${offering.cohortTerms.length} / ${program.terms.length}`} sub="dated of template" />
        <Tile label="Students" value={fmt.num(offering._count.students)} />
      </div>

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

      {/* ── Calendar — this offering's terms and courses on real dates ─────── */}
      {dated.length > 0 && (
        <section className="card card-pad space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Calendar — terms &amp; courses on real dates</h2>
            <p className="text-sm text-slate-500">Each bar is a course inside its term window. Adjust the dates above and this redraws.</p>
          </div>
          <div className="space-y-1.5">
            {/* Term bands */}
            <div className="relative h-6">
              {dated.map((w, i) => (
                <div key={w.term.id} className={`absolute top-0 flex h-5 items-center overflow-hidden rounded px-1.5 text-[10px] font-semibold text-white ${TERM_COLORS[i % TERM_COLORS.length]}`}
                  style={{ left: `${pct(w.start.getTime())}%`, width: `${Math.max(2, pct(w.end.getTime()) - pct(w.start.getTime()))}%` }}
                  title={`${w.term.name}: ${dateFmt(w.start)} → ${dateFmt(w.end)} (${w.weeks} wks)`}>
                  {w.term.name} · {monthDay(w.start)}
                </div>
              ))}
            </div>
            {/* Course bars */}
            {dated.map((w, i) =>
              w.term.courses.map((c) => (
                <div key={c.id} className="relative h-6">
                  <Link href={`/courses/${c.id}`}
                    className={`absolute top-0 flex h-5 items-center overflow-hidden whitespace-nowrap rounded border px-1.5 text-[10px] font-medium hover:ring-2 hover:ring-rose-300 ${TERM_COLORS[i % TERM_COLORS.length].replace("bg-", "border-").replace("500", "300")} bg-white text-slate-700`}
                    style={{ left: `${pct(w.start.getTime())}%`, width: `${Math.max(2, pct(w.end.getTime()) - pct(w.start.getTime()))}%` }}
                    title={`${c.code ?? ""} ${c.name} — ${w.term.name}, ${dateFmt(w.start)} → ${dateFmt(w.end)}`}>
                    {c.code ?? c.name}
                    <span className="ml-1 font-normal text-slate-400">{c.name}</span>
                  </Link>
                </div>
              )),
            )}
            {/* Today line */}
            {spanStart != null && spanEnd != null && today.getTime() >= spanStart && today.getTime() <= spanEnd && (
              <div className="pointer-events-none absolute inset-y-0" />
            )}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>{spanStart != null ? dateFmt(new Date(spanStart)) : ""}</span>
            <span>{spanEnd != null ? dateFmt(new Date(spanEnd)) : ""}</span>
          </div>
        </section>
      )}

      {/* ── Preferred course sequence (template-wide) ──────────────────────── */}
      <section className="card card-pad space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Preferred course sequence</h2>
          <p className="text-sm text-slate-500">
            Which course sits in which term — the program&apos;s template. Drag a course to another term and <strong>every
            offering&apos;s calendar shifts with it</strong> (this one included). Session-level design lives on the{" "}
            <Link href={`/programs/${program.id}/structure`} className="text-rose-700 hover:underline">design &amp; sequence page</Link>.
          </p>
        </div>
        <CourseSequencer programId={program.id} terms={seqTerms} initialCourses={seqCourses} />
      </section>

      {/* Schedule, rooms & sections — THE assignment surface for this offering */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Schedule, rooms, sites &amp; staff</h2>
            <p className="text-sm text-slate-500"><strong>This is where assignments happen.</strong> Every section of every course is a real booking — click any meeting to set its day, time, room (or partner site for clinicals), and instructor / preceptor. Same data as the <Link href="/calendar" className="text-rose-700 hover:underline">master calendar</Link>: change it here, it changes everywhere.</p>
          </div>
        </div>
        {sched && sched.meetings.length > 0 ? (
          <CohortSchedule meetings={sched.meetings} rooms={sched.rooms} people={sched.people} conflictCount={sched.conflictCount} />
        ) : (
          <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50/30 p-6">
            <p className="text-sm text-slate-600">
              This offering hasn&apos;t been calendarized yet — its archetype (sequence, hours, ratios) exists outside space
              and time. Calendarizing expands it into real bookable meetings, auto-placed against room capacity, partner
              sites, and everything already on the institution&apos;s calendar. Then assign staff per meeting.
            </p>
            <form action={calendarizeCohort.bind(null, offering.id, program.id)} className="mt-3">
              <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Calendarize this offering →</button>
            </form>
          </div>
        )}
      </section>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        <Link href="/calendar" className="btn-primary">Master calendar ↦</Link>
        <Link href={`/programs/${program.id}/students`} className="btn-primary">Students ↦</Link>
        {program.familyId && <Link href={`/families/${program.familyId}/wbl`} className="btn-primary">WBL design studio ↦</Link>}
      </div>

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
