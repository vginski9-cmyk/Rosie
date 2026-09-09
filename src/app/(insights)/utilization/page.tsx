import Link from "next/link";
import { getUtilizationExplorer } from "@/lib/queries";
import { presetWindow } from "@/lib/supplyexplorer";
import { UtilizationExplorer } from "@/components/UtilizationExplorer";

export const dynamic = "force-dynamic";

export default async function UtilizationPage({ searchParams }: { searchParams: { inst?: string; preset?: string; from?: string; to?: string } }) {
  const data = await getUtilizationExplorer(searchParams.inst);
  if (!data) return <p className="text-sm text-slate-400">No scheduled meetings yet — calendarize an offering first.</p>;
  const today = new Date().toISOString().slice(0, 10);
  const preset = searchParams.preset || "all";
  const win = preset === "custom" && searchParams.from && searchParams.to ? { from: searchParams.from, to: searchParams.to, label: `${searchParams.from} → ${searchParams.to}` }
    : preset === "all" ? (data.span ? { ...data.span, label: "every scheduled week" } : presetWindow("year", today, data.semesters))
    : presetWindow(preset, today, data.semesters);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/calendar" className="text-sm text-slate-500 hover:text-slate-700">← Master calendar</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Room &amp; campus utilization — {data.institution.name}</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Every booking on the calendar, rolled up any way you think about it: total utilization (booked room-hours ÷ the rooms&apos; coded
          open hours) by day, week, month, semester, year, weekday or hour, and by room, building, campus, program, course, cohort or
          session type — with seat-hours, how full booked rooms run, and bookings outside a room&apos;s hours. Click any row to drill in.
        </p>
      </div>
      <UtilizationExplorer institution={data.institution} institutions={data.institutions} rooms={data.rooms} meetings={data.meetings} semesters={data.semesters} anchors={data.anchors} programs={data.programs} from={win.from} to={win.to} preset={preset} windowLabel={win.label} />
    </div>
  );
}
