import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamily } from "@/lib/queries";
import { FamilyAnalytics, type FamCohort } from "@/components/FamilyAnalytics";
import type { StageKey } from "@/lib/funnel";
import { courseService, DEFAULT_SERVICE, type ServiceSession } from "@/lib/service";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700", planned: "bg-sky-100 text-sky-700", completed: "bg-slate-200 text-slate-600", archived: "bg-slate-100 text-slate-400",
};
const gradYearOf = (name: string): number => { const m = name.match(/(20\d{2})/); return m ? Number(m[1]) : 0; };

export default async function FamilyPage({ params }: { params: { id: string } }) {
  const data = await getFamily(params.id);
  if (!data) notFound();
  const { family, demand } = data;

  // Flatten cohorts across the family's templates into analytics rows, computing
  // each cohort's delivery footprint (FTE / contact hours) at its enrollment.
  const cohorts: FamCohort[] = family.programs.flatMap((p) => {
    const sessions: ServiceSession[] = p.terms.flatMap((t) => t.courses.flatMap((c) => c.sessions.map((s) => ({ id: s.id, kind: s.kind as "CLASS" | "LAB" | "CLINICAL", lengthHours: s.lengthHours, maxStudents: s.maxStudents, facultyNeeded: s.facultyNeeded, preceptorsNeeded: s.preceptorsNeeded }))));
    return p.cohorts.map((co) => {
      const actual: Partial<Record<StageKey, number>> = {};
      for (const s of co.stages) if (s.actualNumber != null) actual[s.stageKey as StageKey] = s.actualNumber;
      const gradYear = gradYearOf(co.name) || co.entryYear || 0;
      const enrolled = actual.enrolled ?? Math.round(co.plannedSeats ?? p.defaultCohortSeats ?? 0);
      const d = sessions.length ? courseService(sessions, Math.max(1, enrolled), DEFAULT_SERVICE).totals : null;
      return {
        id: co.id, name: co.name, programId: p.id, programName: p.name,
        gradYear, entryYear: co.startDate ? co.startDate.getUTCFullYear() : (gradYear ? gradYear - 2 : null),
        status: co.status,
        enrolled,
        completers: actual.completing ?? 0,
        stagesActual: actual,
        facultyFte: d ? Math.round(d.facultyFte * 1000) / 1000 : 0,
        preceptorFte: d ? Math.round(d.preceptorFte * 1000) / 1000 : 0,
        facultyHours: d ? Math.round(d.facultyContactHours) : 0,
        preceptorHours: d ? Math.round(d.preceptorContactHours) : 0,
      };
    });
  }).filter((c) => c.gradYear > 0);

  const demandByYear: Record<number, number> = {};
  for (const d of demand) if (d.openings != null) demandByYear[d.year] = d.openings;
  const goalByYear: Record<number, number> = {};
  for (const p of family.programs) for (const t of p.yearTargets) if (t.credentialTarget != null) goalByYear[t.year] = (goalByYear[t.year] ?? 0) + t.credentialTarget;

  const templates = family.programs.map((p) => ({ id: p.id, name: p.name }));
  const totalCohorts = cohorts.length;
  const totalStudents = family.programs.reduce((n, p) => n + p.cohorts.reduce((m, c) => m + c._count.students, 0), 0);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">← {family.institution.name}</Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{family.name}</h1>
            <p className="text-sm text-slate-500">
              Program family{family.occupation ? <> · {family.occupation.title} · SOC {family.occupation.socCode}</> : null} · {templates.length} template{templates.length === 1 ? "" : "s"} · {totalCohorts} cohorts · {totalStudents} students
            </p>
            {family.description && <p className="mt-1 max-w-3xl text-xs text-slate-400">{family.description}</p>}
          </div>
        </div>
      </div>

      {/* Templates (the program structures) */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Templates <span className="text-sm font-normal text-slate-400">— the program structures</span></h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {family.programs.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link href={`/programs/${p.id}`} className="font-semibold text-slate-800 hover:text-rose-700 hover:underline">{p.name}</Link>
                  <div className="text-xs text-slate-500">{p.programType} · {p.credential} · {p._count.terms} terms · {p.cohorts.length} offerings</div>
                </div>
                <Link href={`/programs/${p.id}/structure`} className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100">Design ↦</Link>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.cohorts.sort((a, b) => gradYearOf(a.name) - gradYearOf(b.name)).map((co) => (
                  <Link key={co.id} href={`/programs/${p.id}/offerings/${co.id}`} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[co.status] ?? "bg-slate-100 text-slate-600"}`}>{co.name}</Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Multi-year goals, trajectory, constellation, health — interactive */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Workforce goals &amp; trajectory</h2>
          <p className="text-sm text-slate-500">
            Anchored to regional demand. The whole family — every template&apos;s cohorts — works toward the multi-year goal.
            Disaggregate by template, switch between the time-series and per-cohort views, and click a year or bar to drill in.
          </p>
        </div>
        {cohorts.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No cohorts yet. Create offerings of the templates above to populate the trajectory.</p>
        ) : (
          <FamilyAnalytics cohorts={cohorts} demandByYear={demandByYear} goalByYear={goalByYear} templates={templates} />
        )}
      </section>
    </div>
  );
}
