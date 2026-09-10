import { getSiteLoad, getFamilyProgramId } from "@/lib/queries";
import { prisma } from "@/lib/db";
import { SiteLoadExplorer } from "@/components/SiteLoadExplorer";

export const dynamic = "force-dynamic";

// CLINICAL SITE LOAD — which employers and facilities carry the students, how full they run,
// who precepts, and the same load by health system, county, ring, setting, program and time.
export default async function SiteLoadPage() {
  const data = await getSiteLoad();
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  const programs = await prisma.program.findMany({ where: { institutionId: data.institution.id }, select: { id: true, name: true, familyId: true } });
  const programIds: Record<string, string> = {};
  for (const p of programs) programIds[p.name] = (p.familyId ? await getFamilyProgramId(p.familyId) : null) ?? p.id;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clinical site load</h1>
        <p className="text-sm text-slate-500">Every clinical shift on the calendar at {data.institution.name}, queried any way: by date, year, semester, term, day of week, cohort, class, student, site, system, county, ring, setting, agreement or status — then who carries the load, any pivot, and CSV out.</p>
      </div>
      <SiteLoadExplorer rows={data.rows} seats={data.seats} programIds={programIds} />
    </div>
  );
}
