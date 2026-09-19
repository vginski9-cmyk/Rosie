import Link from "next/link";
import { getMasterCalendar } from "@/lib/queries";
import { MasterCalendar } from "@/components/MasterCalendar";
import { ProvisionalDatesBanner } from "@/components/Evidence";
import { getCalendarProvenance } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: { inst?: string; week?: string } }) {
  const data = await getMasterCalendar({ institutionId: searchParams.inst, weekMs: searchParams.week && Number.isFinite(Number(searchParams.week)) && Math.abs(Number(searchParams.week) - Date.now()) < 20 * 365 * 86400000 ? Number(searchParams.week) : undefined });
  const provenance = (await getCalendarProvenance(data.institutionId)).all;

  return (
    <div className="space-y-6">
      <PageHeader title={<>Master calendar</>} lede={<>Classes, labs and every clinical shift on one timeline, where each actually lands. Click a block to see or move it.</>} />
      <ProvisionalDatesBanner provenance={provenance} />
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
          conflictGroupCount={data.conflictGroupCount}
          weeks={data.weeks}
          currentWeekMs={data.currentWeekMs}
          programs={data.programs}
          summary={data.summary}
          occurrences={data.occurrences}
          roster={data.roster}
        />
      )}
    </div>
  );
}
