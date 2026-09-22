import { getSiteLoad, getFamilyProgramId, getCalendarProvenance, getCapacityBridge, getCapacityModel } from "@/lib/queries";
import { plannedWindow } from "@/lib/schedulerplan";
import { prisma } from "@/lib/db";
import { SiteLoadExplorer } from "@/components/SiteLoadExplorer";
import { ScopeStrip } from "@/components/ScopeStrip";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

// CLINICAL SITE LOAD — which sites carry the students seat by seat (the placements the scheduler
// wrote), how full each shift runs against the seats open that shift, who supervises (college
// instructor and site preceptor, with the hours each gave), and the same load by health system,
// county, drive-time band, setting, asset, shift, program, supervision model and time.
export default async function SiteLoadPage({ searchParams }: { searchParams: { inst?: string } }) {
  const data = await getSiteLoad(searchParams.inst);
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  const provenance = (await getCalendarProvenance(data.institution.id)).all;
  const cap = await getCapacityModel({ institutionId: data.institution.id });
  const win = cap ? plannedWindow(cap.cohorts) : null;
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
        shows="The roster — one row per student-shift (a named student on a booked seat: an asset at a site, on a date and shift block) as the scheduler placed it, plus hand-made assignments and any shift the plan could not seat. Each row names the shift's college instructor and site preceptor (the plan's or the log's pins, else the section's usual lead staff by role) and states each role's hours on the shift and this learner's share of them (hours ÷ learners on the shift); a role the template does not require reads none required."
        population={`Every student on the roster of every non-archived offering at ${data.institution.name} — not enrollment targets; withdrawn students' past shifts stay, their ${data.withdrawn.excluded} future shifts are left out${data.withdrawn.kept ? ` (${data.withdrawn.kept} kept by flag)` : ""}`}
        window="Every dated shift on record, plus undated ones (no window)"
        constraints={["the placements respect every asset's learners per shift and every site's students-at-once (the scheduler never writes over them) — a shift it could not seat is shown with no seat, never as load"]}
        differs={[["Clinical scheduler", "/scheduler", "counts learner-shifts at enrollment targets (every seat of every section); this page counts the named students in them, so an unfilled or withdrawn seat is the difference"], ["Clinical site capacity", "/insights/clinical-sites", "is a per-date ceiling on the same targets"]]}
      />
      <SiteLoadExplorer rows={data.rows} seats={data.seats} familySettings={data.familySettings} programIds={programIds} />
    </div>
  );
}
