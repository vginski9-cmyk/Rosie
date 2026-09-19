import Link from "next/link";
import { notFound } from "next/navigation";
import { getExpansionStudio } from "@/lib/expansionquery";
import { ExpansionStudio } from "@/components/ExpansionStudio";

export const dynamic = "force-dynamic";

// CAN THIS PROGRAM EXPAND? — use case 1: a workforce target, a proposed design, and the answer as a
// sentence with a date, the constraint that binds first, the cost per worker, and the trace behind it.
export default async function ExpandPage({ params }: { params: { id: string } }) {
  const data = await getExpansionStudio(params.id);
  if (!data) notFound();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Scenarios — can {data.program.name} expand? <span className="text-sm font-normal text-slate-500">— a proposed design, tested against the faculty, preceptors, clinical seats, rooms and calendar {data.program.institution} has today, alongside every offering already planned · <Link href="/scenarios" className="text-rose-700 hover:underline">all programs →</Link></span></h2>
        <p className="text-sm text-slate-600">Nothing here touches the operating plan. A scenario is a named what-if laid on top of every offering already running or planned; the design&apos;s rules are listed before you evaluate, every figure says where it came from, every constraint shows who is on it and what is available, and &quot;In context&quot; lists the offerings that share the window.</p>
      </div>
      <ExpansionStudio program={data.program} scenarios={data.scenarios} defaultDesign={data.defaultDesign} defaultNotes={data.defaultNotes} sitePicks={data.sitePicks} assumptionRowCount={data.assumptionRowCount} />
    </div>
  );
}
