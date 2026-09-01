import Link from "next/link";
import { notFound } from "next/navigation";
import { getOfferingDesign, getCapacityModel } from "@/lib/queries";
import { calendarizeCohort } from "@/lib/actions";
import { OfferingDesign, type DsTerm, type DsMeeting, type DsOverride } from "@/components/OfferingDesign";

export const dynamic = "force-dynamic";

export default async function OfferingDesignPage({ params }: { params: { id: string; cohortId: string } }) {
  const [data, capModel] = await Promise.all([getOfferingDesign(params.cohortId), getCapacityModel()]);
  if (!data || data.cohort.programId !== params.id) notFound();
  const { cohort, rooms, people, employers } = data;
  const program = cohort.program;

  // This offering's per-term enrollment targets + workload assumptions —
  // they drive column C and every formula column on the sheet below.
  const capCohort = capModel?.cohorts.find((c) => c.cohortId === cohort.id) ?? null;

  const ctByTerm = new Map(cohort.cohortTerms.map((ct) => [ct.termId, ct.startDate]));
  const terms: DsTerm[] = [...program.terms].sort((a, b) => a.index - b.index).map((t) => ({
    id: t.id, index: t.index, name: t.name, startWeek: t.startWeek, endWeek: t.endWeek,
    startDate: ctByTerm.get(t.id)?.toISOString().slice(0, 10) ?? null,
    courses: t.courses.map((c) => {
      const cd = cohort.courseDates.find((x) => x.courseId === c.id);
      return {
      id: c.id, code: c.code, name: c.name,
      startDate: cd?.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: cd?.endDate?.toISOString().slice(0, 10) ?? null,
      sessions: c.sessions.map((s) => ({
        id: s.id, kind: s.kind, number: s.number, title: s.title,
        deliveryMode: s.deliveryMode, location: s.location,
        lengthHours: s.lengthHours, maxStudents: s.maxStudents,
        facultyNeeded: s.facultyNeeded, facultyContactPolicy: s.facultyContactPolicy,
        supportStaffNeeded: s.supportStaffNeeded, supportContactPolicy: s.supportContactPolicy,
        preceptorsNeeded: s.preceptorsNeeded, preceptorContactPolicy: s.preceptorContactPolicy,
        week: s.week, dayOfWeek: s.dayOfWeek, startTime: s.startTime,
        notes: s.notes, rotationType: s.rotationType, clinicalMode: s.clinicalMode,
      })),
      };
    }),
  }));
  const overrides: DsOverride[] = cohort.sessionOverrides.map((o) => ({
    sessionId: o.sessionId, week: o.week, dayOfWeek: o.dayOfWeek, startTime: o.startTime, notes: o.notes,
    title: o.title, deliveryMode: o.deliveryMode, location: o.location,
    lengthHours: o.lengthHours, maxStudents: o.maxStudents,
    facultyNeeded: o.facultyNeeded, facultyContactPolicy: o.facultyContactPolicy,
    supportStaffNeeded: o.supportStaffNeeded, supportContactPolicy: o.supportContactPolicy,
    preceptorsNeeded: o.preceptorsNeeded, preceptorContactPolicy: o.preceptorContactPolicy,
    rotationType: o.rotationType, clinicalMode: o.clinicalMode,
  }));
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
          the boilerplate; this is <strong>this instantiation&apos;s</strong> copy of it — the <strong>same Raw Data &amp;
          Calculations columns (A–AE)</strong>, with column C set to <strong>this offering&apos;s enrollment target per
          term</strong> so every formula shows what this run actually needs, plus each session&apos;s <strong>real date,
          time, booked location, and instructor / preceptor</strong>. Edit any weekly pattern (day, time, room or partner
          site, staff) and the same booking updates on the{" "}
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

      <OfferingDesign
        programId={program.id}
        cohortId={cohort.id}
        terms={terms}
        meetings={meetings}
        overrides={overrides}
        rooms={rooms}
        people={people}
        employers={employers}
        enrollmentByTerm={capCohort?.enrollmentByTerm ?? {}}
        assumptions={capCohort?.assumptions ?? { facContactHours: program.facContactHours, facWorkWeekHours: program.facWorkWeekHours, facTermWeeks: program.facTermWeeks, preContactHours: program.preContactHours, preWorkWeekHours: program.preWorkWeekHours, preTermWeeks: program.preTermWeeks }}
      />
    </div>
  );
}
