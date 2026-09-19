import { getSiteLoad, getFamilyProgramId, getCalendarProvenance, getCapacityBridge, getCapacityModel } from "@/lib/queries";
import { schedulerWindow } from "@/lib/schedulerplan";
import { prisma } from "@/lib/db";
import { SiteLoadExplorer } from "@/components/SiteLoadExplorer";
import { ScopeStrip } from "@/components/ScopeStrip";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

// CLINICAL SITE LOAD — which employers and facilities carry the students, how full they run,
// who precepts, and the same load by health system, county, ring, setting, program and time.
export default async function SiteLoadPage({ searchParams }: { searchParams: { inst?: string } }) {
  const data = await getSiteLoad(searchParams.inst);
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  const provenance = (await getCalendarProvenance(data.institution.id)).all;
  const cap = await getCapacityModel({ institutionId: data.institution.id });
  const win = cap ? schedulerWindow(cap.cohorts) : null;
  const bridge = win ? await getCapacityBridge(data.institution.id, win.from, win.to) : null;
  const programs = await prisma.program.findMany({ where: { institutionId: data.institution.id }, select: { id: true, name: true, familyId: true } });
  const programIds: Record<string, string> = {};
  for (const p of programs) programIds[p.name] = (p.familyId ? await getFamilyProgramId(p.familyId) : null) ?? p.id;
  return (
    <div className="space-y-4">
      <PageHeader title={<>Clinical site load</>} lede={<>Who carries the clinical load: every shift on the calendar, sliced any way, with CSV out.</>} />
      <ScopeStrip
        provisional={provenance}
        bridge={bridge} self="load"
        shows="The roster — one row per student-shift actually assigned (a named student at a site on a date), from the applied plan and hand-made assignments."
        population={`Every student on the roster of every planned, running or completed offering at ${data.institution.name} — not enrollment targets; withdrawn students' past shifts stay, their ${data.withdrawn.excluded} future shifts are left out${data.withdrawn.kept ? ` (${data.withdrawn.kept} kept by flag)` : ""}`}
        window="Every dated shift on record, plus undated ones (no window)"
        constraints={["none — this is what was assigned, whatever the levers said"]}
        differs={[["Clinical scheduler", "/scheduler", "plans learner-shifts at enrollment targets in a fixed window, so its demand is a different count"], ["Clinical site capacity", "/insights/clinical-sites", "is a per-date ceiling on the same targets"]]}
      />
      <SiteLoadExplorer rows={data.rows} seats={data.seats} programIds={programIds} />
    </div>
  );
}
