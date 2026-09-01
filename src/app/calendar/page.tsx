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
          offering&apos;s calendar.
        </p>
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
