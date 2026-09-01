import Link from "next/link";
import { notFound } from "next/navigation";
import { getOfferingDesign, getCapacityModel } from "@/lib/queries";
import { calendarizeCohort } from "@/lib/actions";
import { OfferingDesign, type DsTerm, type DsMeeting, type DsOverride } from "@/components/OfferingDesign";
import { buildInstances, weeklyNeedByKind, type CohortCalendarInput } from "@/lib/capacitymodel";

export const dynamic = "force-dynamic";

export default async function OfferingDesignPage({ params }: { params: { id: string; cohortId: string } }) {
  const [data, capModel] = await Promise.all([getOfferingDesign(params.cohortId), getCapacityModel()]);
  if (!data || data.cohort.programId !== params.id) notFound();
  const { cohort, rooms, people, employers } = data;
  const program = cohort.program;

  // Week-by-week staffing need for THIS instantiation, by session type —
  // overrides and booked day patterns included (same engine as Insights).
  const capCohort = capModel?.cohorts.find((c) => c.cohortId === cohort.id) ?? null;
  const weeklyByKind = capCohort
    ? weeklyNeedByKind(buildInstances({
        cohortId: capCohort.cohortId, cohort: capCohort.cohort, programId: capCohort.programId, program: capCohort.program,
        enrollmentByTerm: capCohort.enrollmentByTerm,
        termStartByIndex: Object.fromEntries(Object.entries(capCohort.termStartByIndex).map(([k, v]) => [k, v ? new Date(v) : null])),
        courses: capCohort.courses,
      } as CohortCalendarInput, capCohort.assumptions).filter((i) => i.mondayIso != null))
    : [];
  const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1 });
  const fmtW = (isoStr: string) => new Date(isoStr + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });

  const ctByTerm = new Map(cohort.cohortTerms.map((ct) => [ct.termId, ct.startDate]));
  const terms: DsTerm[] = [...program.terms].sort((a, b) => a.index - b.index).map((t) => ({
    id: t.id, index: t.index, name: t.name, startWeek: t.startWeek, endWeek: t.endWeek,
    startDate: ctByTerm.get(t.id)?.toISOString().slice(0, 10) ?? null,
    courses: t.courses.map((c) => ({
      id: c.id, code: c.code, name: c.name,
      sessions: c.sessions.map((s) => ({
        id: s.id, kind: s.kind, number: s.number, title: s.title,
        deliveryMode: s.deliveryMode, location: s.location,
        lengthHours: s.lengthHours, maxStudents: s.maxStudents,
        week: s.week, dayOfWeek: s.dayOfWeek, startTime: s.startTime,
        notes: s.notes, rotationType: s.rotationType, clinicalMode: s.clinicalMode,
      })),
    })),
  }));
  const overrides: DsOverride[] = cohort.sessionOverrides.map((o) => ({ sessionId: o.sessionId, week: o.week, dayOfWeek: o.dayOfWeek, startTime: o.startTime, notes: o.notes }));
  const meetings: DsMeeting[] = cohort.meetings.map((m) => ({
    id: m.id, courseId: m.courseId, kind: m.kind, sectionIndex: m.sectionIndex, sectionCount: m.sectionCount, seats: m.seats,
    dayOfWeek: m.dayOfWeek, startTime: m.startTime, lengthHours: m.lengthHours,
    facilityId: m.facilityId, facilityName: m.facility?.name ?? null,
    employerId: m.employerId, employerName: m.employer?.name ?? null,
    staffPersonId: m.staffPersonId, staffName: m.staff?.name ?? null,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link href={`/programs/${program.id}/offerings/${cohort.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {cohort.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Design &amp; sequence — {cohort.name}</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The <Link href={`/programs/${program.id}/structure`} className="text-rose-700 hover:underline">template</Link> is
          the boilerplate; this is <strong>this instantiation&apos;s</strong> copy of it — every session of every course with
          its <strong>real date, time, location, and instructor / preceptor</strong>. Edit any weekly pattern (day, time,
          room or partner site, staff) and the same booking updates on the{" "}
          <Link href="/calendar" className="text-rose-700 hover:underline">master calendar</Link> and everywhere else.
        </p>
      </div>

      {meetings.length === 0 && (
        <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50/30 p-5">
          <p className="text-sm text-slate-600">
            This offering isn&apos;t calendarized yet — sessions have no bookable day/time/location until it is.
          </p>
          <form action={calendarizeCohort.bind(null, cohort.id, program.id)} className="mt-3">
            <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Calendarize this offering →</button>
          </form>
        </div>
      )}

      {/* Week-by-week staffing need — class / lab / clinical faculty + preceptors */}
      {weeklyByKind.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">Staffing need by week — this instantiation</h2>
            <p className="text-[11px] text-slate-400">
              Class / lab / clinical faculty FTE and preceptor FTE each calendar week, from the session table at this
              offering&apos;s enrollment and dates (overrides included). People = FTE rounded up. Institution-wide view lives
              under <Link href="/insights/staffing-need" className="text-rose-700 hover:underline">Insights → Instructors &amp; preceptors</Link>.
            </p>
          </div>
          <div className="max-h-[24rem] overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-semibold">Week of</th>
                  <th className="px-3 py-2 text-right font-semibold">Class fac FTE</th>
                  <th className="px-3 py-2 text-right font-semibold">Lab fac FTE</th>
                  <th className="px-3 py-2 text-right font-semibold">Clinical fac FTE</th>
                  <th className="px-3 py-2 text-right font-semibold">Faculty total (people)</th>
                  <th className="px-3 py-2 text-right font-semibold">Preceptor FTE (people)</th>
                  <th className="px-3 py-2 text-right font-semibold">Sections</th>
                </tr>
              </thead>
              <tbody>
                {weeklyByKind.map((w) => (
                  <tr key={w.mondayIso} className="border-b border-slate-50">
                    <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-700">{fmtW(w.mondayIso)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-sky-700">{w.classFte ? n1(w.classFte) : "·"}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-violet-700">{w.labFte ? n1(w.labFte) : "·"}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-rose-700">{w.clinicalFacFte ? n1(w.clinicalFacFte) : "·"}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold text-slate-800">{n1(w.totalFacFte)} ({w.facultyHeads})</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold text-amber-700">{w.preceptorFte ? `${n1(w.preceptorFte)} (${w.preceptorHeads})` : "·"}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500">{Math.round(w.sections)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <OfferingDesign
        programId={program.id}
        cohortId={cohort.id}
        terms={terms}
        meetings={meetings}
        overrides={overrides}
        rooms={rooms}
        people={people}
        employers={employers}
      />
    </div>
  );
}
