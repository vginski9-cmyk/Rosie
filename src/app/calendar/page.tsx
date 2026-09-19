import { getCalendarView } from "@/lib/calendarquery";
import { isCalView, isValidIso, type CalView, type EventKind } from "@/lib/calendarview";
import { MasterCalendar } from "@/components/MasterCalendar";
import { ProvisionalDatesBanner } from "@/components/Evidence";
import { getCalendarProvenance } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

// THE MASTER CALENDAR — everything that happens, at any grain, for anyone or anything you search.
export default async function CalendarPage({ searchParams }: { searchParams: { inst?: string; view?: string; date?: string; who?: string; kind?: string; program?: string } }) {
  const view: CalView = isCalView(searchParams.view) ? searchParams.view : "week";
  const date = isValidIso(searchParams.date) ? searchParams.date : new Date().toISOString().slice(0, 10);
  const kind = (["CLASS", "LAB", "CLINICAL"] as const).includes(searchParams.kind as EventKind) ? (searchParams.kind as EventKind) : null;
  const data = await getCalendarView({ institutionId: searchParams.inst, view, dateIso: date, who: searchParams.who ?? null, kind, programId: searchParams.program ?? null });
  const provenance = data.institutionId ? (await getCalendarProvenance(data.institutionId)).all : null;

  return (
    <div className="space-y-4">
      <PageHeader title="Master calendar" lede="Every class, lab and clinical shift, where it actually lands. Search anyone or anything; look at a day, a week, a month, a quarter, a semester or a year." meta={data.institutionName ?? undefined} />
      {provenance && <ProvisionalDatesBanner provenance={provenance} />}
      <MasterCalendar data={data} state={{ view, date, who: data.who ? `${data.who.kind}:${data.who.id}` : null, kind, program: searchParams.program ?? null }} />
    </div>
  );
}
