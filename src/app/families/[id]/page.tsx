import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamily, getInsightsFacts } from "@/lib/queries";
import { FamilyAnalytics, type FamCohort } from "@/components/FamilyAnalytics";
import { GoalPlanner } from "@/components/GoalPlanner";
import { PivotExplorer } from "@/components/PivotExplorer";
import type { StageKey } from "@/lib/funnel";
import { courseService, DEFAULT_SERVICE, type ServiceSession } from "@/lib/service";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700", planned: "bg-sky-100 text-sky-700", completed: "bg-slate-200 text-slate-600", archived: "bg-slate-100 text-slate-400",
};
const gradYearOf = (name: string): number => { const m = name.match(/(20\d{2})/); return m ? Number(m[1]) : 0; };

export default async function FamilyPage({ params }: { params: { id: string } }) {
  const [data, allFacts] = await Promise.all([getFamily(params.id), getInsightsFacts()]);
  if (!data) notFound();
  const { family, demand } = data;
  // Same tidy fact table as the Insights explorer, scoped to this family.
  const familyFacts = allFacts.filter((f) => f.family === family.name && f.institution === family.institution.name);

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

  // Seeds for the multi-year North-Star goal planner: the span of years the
  // family is planning for (its target years ∪ cohort grad years), and the
  // per-year goals from the family's credential targets.
  const cohortYears = cohorts.map((c) => c.gradYear).filter((y) => y > 0);
  const yearSet = new Set<number>([...Object.keys(goalByYear).map(Number), ...Object.keys(demandByYear).map(Number), ...cohortYears]);
  const seedYears = [...yearSet].sort((a, b) => a - b);
  const seedGoalsByYear: Record<number, number> = goalByYear;
  const seedTerms = Math.max(5, ...family.programs.map((p) => p._count.terms));

  // Group the family's delivery-model templates by credential (AAS / Diploma / Cert),
  // citing how many fully-productive workers each is expected to deliver this year.
  const homeYear = new Date().getUTCFullYear();
  const targetFor = (p: (typeof family.programs)[number], y: number) => p.yearTargets.find((t) => t.year === y)?.credentialTarget ?? 0;
  const credGroups = (() => {
    const m = new Map<string, { credential: string; expected: number; programs: { p: (typeof family.programs)[number]; running: number; expected: number }[] }>();
    for (const p of family.programs) {
      const cred = p.credential || "Other";
      const running = p.cohorts.filter((c) => c.status === "active" || c.status === "planned").length;
      const e = m.get(cred) ?? { credential: cred, expected: 0, programs: [] };
      e.expected += targetFor(p, homeYear);
      e.programs.push({ p, running, expected: targetFor(p, homeYear) });
      m.set(cred, e);
    }
    return [...m.values()].sort((a, b) => b.expected - a.expected || a.credential.localeCompare(b.credential));
  })();
  const CRED_BADGE: Record<string, string> = { AAS: "bg-rose-100 text-rose-700", Diploma: "bg-violet-100 text-violet-700", Certificate: "bg-sky-100 text-sky-700", Cert: "bg-sky-100 text-sky-700", Other: "bg-slate-100 text-slate-600" };

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

      {/* Credentials → delivery-model templates → instantiations */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Credentials &amp; delivery models <span className="text-sm font-normal text-slate-400">— who delivers toward this job ({homeYear})</span></h2>
        {credGroups.map((g) => (
          <div key={g.credential} className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${CRED_BADGE[g.credential] ?? CRED_BADGE.Other}`}>{g.credential}</span>
                <span className="text-xs text-slate-500">{g.programs.length} delivery model{g.programs.length === 1 ? "" : "s"}</span>
              </div>
              <span className="text-sm tabular-nums text-slate-600"><strong className="text-slate-800">{g.expected}</strong> productive / yr expected</span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {g.programs.map(({ p, running, expected }) => (
                <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link href={`/programs/${p.id}`} className="font-semibold text-slate-800 hover:text-rose-700 hover:underline">{p.name}</Link>
                      <div className="text-xs text-slate-500">{p._count.terms}-term structure · {expected} productive/yr · {running} running · {p.cohorts.length} total offerings</div>
                    </div>
                    <Link href={`/programs/${p.id}/structure`} className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100">Design ↦</Link>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.cohorts.sort((a, b) => gradYearOf(a.name) - gradYearOf(b.name)).map((co) => (
                      <Link key={co.id} href={`/programs/${p.id}/offerings/${co.id}`} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[co.status] ?? "bg-slate-100 text-slate-600"}`}>{co.name}</Link>
                    ))}
                    {p.cohorts.length === 0 && <span className="text-[11px] text-slate-400">no instantiations yet</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* North-Star goal planner — set the goal + adjust every % in a row, autocalculated */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">North-Star goal &amp; pipeline plan</h2>
          <p className="text-sm text-slate-500">
            Set the family&apos;s multi-year goal, then adjust any health-metric percentage — goal or actual — and the whole
            pipeline ladder, including term-by-term enrollment, recomputes live. This is how each program anchors its activity
            to the workforce goal it&apos;s working toward.
          </p>
        </div>
        <GoalPlanner familyId={family.id} familyName={family.name} seedYears={seedYears} seedGoalsByYear={seedGoalsByYear} seedTerms={seedTerms} savedPlan={family.goalPlan ?? null} />
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

      {/* Family-scoped pivot — all this family's data, aggregate or disaggregate */}
      {familyFacts.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Explore this family&apos;s data</h2>
            <p className="text-sm text-slate-500">
              Every offering&apos;s pipeline and delivery footprint in one tidy table — disaggregate by cohort, term, semester,
              year or metric. Click a header to filter, a cell to drill into the underlying facts. Want a specific class? Pick
              the cohort. Want Spring 2026? Pick the semester.
            </p>
          </div>
          <PivotExplorer facts={familyFacts} hideDims={["institution", "family"]} defaultRowDim="cohort" defaultColDim="metric" defaultMetric="All" />
        </section>
      )}
    </div>
  );
}
