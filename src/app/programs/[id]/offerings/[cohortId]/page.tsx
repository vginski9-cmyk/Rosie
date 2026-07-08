import Link from "next/link";
import { notFound } from "next/navigation";
import { getOffering, getOfferingStaffing, getCohortSchedule } from "@/lib/queries";
import { FunnelChart } from "@/components/FunnelChart";
import { OfferingStaffing } from "@/components/OfferingStaffing";
import { CohortSchedule } from "@/components/CohortSchedule";
import { fmt } from "@/lib/format";
import type { StageKey } from "@/lib/funnel";
import { computeCohortTiming, type TimingTerm } from "@/lib/term";

export const dynamic = "force-dynamic";

const dateFmt = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

const STATUS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700", planned: "bg-sky-100 text-sky-700",
  completed: "bg-slate-200 text-slate-600", archived: "bg-slate-100 text-slate-400",
};
const PHASE_LABEL: Record<string, string> = { recruiting: "Recruiting", "in-program": "In program", graduated: "Graduated", unscheduled: "Unscheduled" };
const PHASE_BADGE: Record<string, string> = {
  recruiting: "bg-sky-100 text-sky-700", "in-program": "bg-emerald-100 text-emerald-700",
  graduated: "bg-slate-200 text-slate-600", unscheduled: "bg-slate-100 text-slate-400",
};

export default async function OfferingPage({ params }: { params: { id: string; cohortId: string } }) {
  const offering = await getOffering(params.cohortId);
  if (!offering || offering.programId !== params.id) notFound();
  const program = offering.program;
  const staffing = await getOfferingStaffing(params.cohortId);
  const sched = await getCohortSchedule(params.cohortId);

  // Real date per template term for THIS offering.
  const termDate = new Map(offering.cohortTerms.map((ct) => [ct.termId, ct.startDate]));

  // Where this offering sits in its lifecycle right now (vs today): current term,
  // expected end, and phase — derived from the template's actual term structure.
  const today = new Date();
  const orderedTerms = [...program.terms].sort((a, b) => a.index - b.index);
  const timingTerms: TimingTerm[] = orderedTerms.map((t) => ({ index: t.index, name: t.name, startWeek: t.startWeek, endWeek: t.endWeek }));
  const realTermStarts = orderedTerms.map((t) => termDate.get(t.id) ?? null);
  const timing = computeCohortTiming(offering.startDate ?? null, timingTerms, today, realTermStarts);
  const monthYear = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—");

  return (
    <div className="mx-auto max-w-5xl space-y-8">
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

      <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 text-sm text-slate-600">
        <strong>Template vs. offering:</strong> the program defines the structure once, timelessly. This offering binds that
        structure to a real calendar, a specific roster of instructors, and the enrolled students below.
      </div>

      {/* Counts + timing */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Starts" value={offering.startDate ? dateFmt(offering.startDate) : "—"} />
        <Tile label="Current term" value={timing.phase === "in-program" ? (timing.currentTermName ?? "—") : "—"} sub={timing.phase === "in-program" ? `week ${(timing.weeksElapsed ?? 0) + 1} of ${timing.totalWeeks}` : PHASE_LABEL[timing.phase].toLowerCase()} />
        <Tile label="Expected end" value={timing.endDate ? monthYear(timing.endDate) : "—"} sub={`${timing.totalWeeks}-week program`} />
        <Tile label="Scheduled terms" value={`${offering.cohortTerms.length} / ${program.terms.length}`} sub="dated of template" />
        <Tile label="Students" value={fmt.num(offering._count.students)} />
        <Tile label="Staff assignments" value={fmt.num(offering._count.sessionStaff)} sub="per-session, this run" />
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        <Link href="/calendar" className="btn-primary">Master calendar ↦</Link>
        <Link href={`/programs/${program.id}/students`} className="btn-primary">Students ↦</Link>
        <Link href={`/programs/${program.id}/wbl`} className="btn-primary">WBL placement board ↦</Link>
        <Link href={`/programs/${program.id}/plan`} className="btn-ghost">Operations plan</Link>
      </div>

      {/* Schedule, rooms & sections — the real bookings (shared with the master calendar) */}
      {sched && sched.meetings.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">Schedule, rooms &amp; sections</h2>
              <p className="text-sm text-slate-500">Every section of every course as a real booking — its day, time, room, and instructor. This is the same data the <Link href="/calendar" className="text-rose-700 hover:underline">master space calendar</Link> shows; move a section here and it moves there too.</p>
            </div>
          </div>
          <CohortSchedule meetings={sched.meetings} rooms={sched.rooms} conflictCount={sched.conflictCount} />
        </section>
      )}

      {/* The run's term calendar */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Term schedule</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-semibold">Template term</th>
                <th className="px-4 py-3 text-center font-semibold">Courses</th>
                <th className="px-4 py-3 font-semibold">This offering starts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {program.terms.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-800">{t.name}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-slate-500">{t._count.courses}</td>
                  <td className="px-4 py-3 text-slate-700">{termDate.has(t.id) ? dateFmt(termDate.get(t.id)) : <span className="text-slate-300">not scheduled</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-instantiation staffing + time-bound analytics */}
      {staffing && (
        <OfferingStaffing
          cohortId={offering.id} programId={program.id}
          terms={staffing.program.terms.map((t) => ({ id: t.id, name: t.name, courses: t.courses.map((c) => ({ id: c.id, code: c.code, name: c.name, sessions: c.sessions })) }))}
          staff={staffing.staff}
          people={staffing.people}
        />
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
