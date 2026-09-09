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
        <p className="max-w-3xl text-sm text-slate-500">
          Everything on one timeline — campus classes and labs AND every clinical rotation at partner sites (dashed ⚕
          blocks; &quot;site TBD&quot; until one is assigned). Click any block for its full detail — course, session-by-session
          titles, location, instructor or preceptor — and move or reassign it; the change flows straight back to that
          offering&apos;s calendar. Every week shows all seven days; color the blocks by program, by session type, or by
          location to see at a glance which bookings share a room or site.
        </p>
      </div>
      <Link href={`/utilization${data.institutionId ? `?inst=${data.institutionId}` : ""}`} className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50/40 px-4 py-3 hover:border-rose-300 hover:bg-rose-50/70">
        <div>
          <div className="text-sm font-semibold text-slate-800">Utilization analytics ↦</div>
          <div className="text-xs text-slate-500">Total utilization and booked vs open room-hours by day, week, month, semester, year — and by room, building, campus, program, course, cohort or session type. Drill into any row.</div>
        </div>
        <span className="text-rose-600">→</span>
      </Link>
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
