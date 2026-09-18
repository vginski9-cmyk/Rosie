import { getSiteLoad, getFamilyProgramId, getCalendarProvenance } from "@/lib/queries";
import { prisma } from "@/lib/db";
import { SiteLoadExplorer } from "@/components/SiteLoadExplorer";
import { ScopeStrip } from "@/components/ScopeStrip";

export const dynamic = "force-dynamic";

// CLINICAL SITE LOAD — which employers and facilities carry the students, how full they run,
// who precepts, and the same load by health system, county, ring, setting, program and time.
export default async function SiteLoadPage({ searchParams }: { searchParams: { inst?: string } }) {
  const data = await getSiteLoad(searchParams.inst);
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  const provenance = (await getCalendarProvenance(data.institution.id)).all;
  const programs = await prisma.program.findMany({ where: { institutionId: data.institution.id }, select: { id: true, name: true, familyId: true } });
  const programIds: Record<string, string> = {};
  for (const p of programs) programIds[p.name] = (p.familyId ? await getFamilyProgramId(p.familyId) : null) ?? p.id;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clinical site load</h1>
        <p className="text-sm text-slate-500">Every clinical shift on the calendar at {data.institution.name}, queried any way: by date, year, semester, term, day of week, cohort, class, student, site, system, county, ring, setting, agreement or status — then who carries the load, any pivot, and CSV out.</p>
      </div>
      <ScopeStrip
        provisional={provenance}
        shows="The roster — one row per student-shift actually assigned (a named student at a site on a date), from the applied plan and hand-made assignments."
        population={`Every student on the roster of every planned, running or completed offering at ${data.institution.name} — not enrollment targets; withdrawn students' past shifts stay`}
        window="Every dated shift on record, plus undated ones (no window)"
        constraints={["none — this is what was assigned, whatever the levers said"]}
        differs={[["Clinical scheduler", "/scheduler", "plans learner-shifts at enrollment targets in a fixed window, so its demand is a different count"], ["Clinical site capacity", "/insights/clinical-sites", "is a per-date ceiling on the same targets"]]}
      />
      <SiteLoadExplorer rows={data.rows} seats={data.seats} programIds={programIds} />
    </div>
  );
}
