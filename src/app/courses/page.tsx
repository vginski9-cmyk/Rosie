import { getCourseDemand } from "@/lib/queries";
import { CourseDemand } from "@/components/CourseDemand";

export const dynamic = "force-dynamic";

export default async function CourseDemandPage({ searchParams }: { searchParams: { inst?: string } }) {
  const { rows, institutionId } = await getCourseDemand({ institutionId: searchParams.inst });
  const totalDemand = rows.reduce((n, r) => n + r.totalStudents, 0);
  const short = rows.filter((r) => r.totalStudents - r.seatsScheduled > 0).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shared course demand</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          When several programs require the <strong>same course</strong> — the gen-eds every health-sciences student takes —
          their demand pools. See how big each course really needs to be to seat everyone, exactly which programs the demand
          comes from, how many sections are currently scheduled, and drill into the specific enrolled students.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-slate-100 px-2 py-0.5">{rows.length} shared courses</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5">{totalDemand} pooled student-seats of demand</span>
        {short > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700">{short} under-seated</span>}
      </div>
      {institutionId && <CourseDemand rows={rows} institutionId={institutionId} />}
    </div>
  );
}
