import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamilyClinical, getCapacityModel, getAssetMap } from "@/lib/queries";
import { FamilyClinicalBoard } from "@/components/FamilyClinicalBoard";
import { AssetMapBoard } from "@/components/AssetMapBoard";
import type { CourseWindow } from "@/lib/clinicalmodel";

export const dynamic = "force-dynamic";

// One job's clinical picture: its model, service areas and requirement grid,
// the sites and assets that serve it, allocated shifts, hours supply vs demand
// by week — and, below, the asset-level 365-day board for that job's settings.
export default async function FamilyClinicalPage({ params }: { params: { id: string } }) {
  const data = await getFamilyClinical(params.id);
  if (!data) notFound();
  const cap = await getCapacityModel({ institutionId: data.family.institutionId });
  const cohorts = (cap?.cohorts ?? []).filter((c) => c.familyId === data.family.id);
  // Course windows: each offering's courses with their real start and the students in that term.
  const weeksByCourse = new Map(data.programs.flatMap((p) => p.courses.map((c) => [c.id, c.weeks] as [string, number])));
  const windows: CourseWindow[] = cohorts.flatMap((c) => c.courses.filter((x) => x.courseId).map((x) => {
    const start = x.startDate ?? c.termStartByIndex[x.termIndex] ?? null;
    const weeks = x.startDate && x.endDate ? Math.max(1, Math.round((new Date(x.endDate).getTime() - new Date(x.startDate).getTime()) / (7 * 86400000))) : weeksByCourse.get(x.courseId!) ?? 16;
    return { cohortId: c.cohortId, cohort: c.cohort, programId: c.programId, program: c.program, courseId: x.courseId!, courseCode: x.code, courseName: x.title, termIndex: x.termIndex, students: c.enrollmentByTerm[x.termIndex] ?? 0, startIso: start ? start.slice(0, 10) : null, weeks };
  }));
  const starts = windows.map((w) => w.startIso).filter((s): s is string => !!s).sort();
  const todayIso = new Date().toISOString().slice(0, 10);
  const from = starts[0] ?? todayIso;
  const lastStart = starts[starts.length - 1] ?? todayIso;
  const to = new Date(new Date(lastStart + "T00:00:00Z").getTime() + 20 * 7 * 86400000).toISOString().slice(0, 10);
  const year = Number(from.slice(0, 4)) + 1;
  const map = await getAssetMap(data.family.institutionId, from, to);
  const codes = new Set(data.settingCodes);
  const assets = map.assets.filter((a) => codes.has(a.settingCode));
  const assetIds = new Set(assets.map((a) => a.id));
  const rotations = map.rotations.filter((r) => !r.settingCode || codes.has(r.settingCode));
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/families/${data.family.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {data.family.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Clinical sites &amp; supply — {data.family.name}</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          {data.family.occupation ?? data.family.name}{data.family.soc ? ` (SOC ${data.family.soc})` : ""} at {data.family.institution}. Everything here is scoped to how <strong>this</strong> job administers clinicals: its service areas, its requirement grid, its site agreements, the shifts sites allocate to it, and the hours it needs against the hours the region can supply — week by week, setting by setting, county by county.
        </p>
      </div>
      <FamilyClinicalBoard family={data.family} areas={data.serviceAreas} programs={data.programs} sites={data.sites} allocations={data.allocations} windows={windows} assets={assets} overrides={map.overrides.filter((o) => assetIds.has(o.assetId))} bookings={map.bookings.filter((b) => assetIds.has(b.assetId))} from={from} to={to} />
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">Asset by asset, day by day — {data.family.name}&apos;s settings only</h2>
        <AssetMapBoard institutionId={data.family.institutionId} assets={assets} overrides={map.overrides.filter((o) => assetIds.has(o.assetId))} bookings={map.bookings.filter((b) => assetIds.has(b.assetId))} rotations={rotations} cohorts={cohorts} from={from} to={to} year={year} />
      </section>
    </div>
  );
}
