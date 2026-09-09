import Link from "next/link";
import { getMasterCalendar } from "@/lib/queries";
import { MasterCalendar } from "@/components/MasterCalendar";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: { inst?: string; week?: string } }) {
  const data = await getMasterCalendar({ institutionId: searchParams.inst, weekMs: searchParams.week ? Number(searchParams.week) : undefined });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Master calendar</h1>
        <p className="text-sm text-slate-500">Campus classes and labs and every clinical rotation on one timeline. Click a block to see or move it; the change flows back to the offering. <Link href={`/utilization${data.institutionId ? `?inst=${data.institutionId}` : ""}`} className="text-rose-600 hover:underline">Room utilization →</Link></p>
      </div>
      {data.institutionId == null ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No scheduled meetings yet.</p>
      ) : (
        <MasterCalendar
          institutions={data.institutions}
          institutionId={data.institutionId}
          rooms={data.rooms}
          people={data.people}
          employers={data.employers}
          meetings={data.meetings}
          conflicts={data.conflicts}
          weeks={data.weeks}
          currentWeekMs={data.currentWeekMs}
          programs={data.programs}
          summary={data.summary}
        />
      )}
    </div>
  );
}
