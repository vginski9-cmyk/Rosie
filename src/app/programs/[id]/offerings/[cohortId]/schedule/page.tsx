import Link from "next/link";
import { notFound } from "next/navigation";
import { getOfferingScheduler } from "@/lib/queries";
import { OfferingScheduler, type SchedTerm } from "@/components/OfferingScheduler";

export const dynamic = "force-dynamic";

export default async function OfferingSchedulePage({ params }: { params: { id: string; cohortId: string } }) {
  const data = await getOfferingScheduler(params.cohortId);
  if (!data || data.program.id !== params.id) notFound();
  const { cohort, program, enrollment, overrides } = data;

  const terms: SchedTerm[] = program.terms.map((t) => ({
    id: t.id, name: t.name, index: t.index,
    courses: t.courses.map((c) => ({
      id: c.id, code: c.code, name: c.name,
      sessions: c.sessions.map((s) => ({
        id: s.id, kind: s.kind as "CLASS" | "LAB" | "CLINICAL", number: s.number, title: s.title,
        lengthHours: s.lengthHours, maxStudents: s.maxStudents, dayOfWeek: s.dayOfWeek, startTime: s.startTime, location: s.location,
      })),
    })),
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/programs/${program.id}/offerings/${cohort.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {cohort.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Section scheduler — {cohort.name}</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Place each <strong>section</strong> of every course into a weekly slot for this offering. Six lab sections can&apos;t
          all run at once — stagger them across days, times, and rooms. Sections sharing a room at overlapping times are
          flagged as <strong>clashes</strong>; the per-day peak shows how many rooms and faculty you need simultaneously.
          The template&apos;s default day/time is the starting point — adjustments here belong to <em>this run</em> only.
        </p>
      </div>

      <OfferingScheduler
        cohortId={cohort.id} programId={program.id} offeringName={cohort.name}
        enrollment={enrollment} terms={terms} overrides={overrides}
      />
    </div>
  );
}
