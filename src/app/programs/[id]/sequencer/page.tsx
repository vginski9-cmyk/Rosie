import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramFull } from "@/lib/queries";
import { CourseSequencer, type SeqCourse, type SeqTerm } from "@/components/CourseSequencer";

export const dynamic = "force-dynamic";

export default async function SequencerPage({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();

  const terms: SeqTerm[] = program.terms.map((t) => ({ id: t.id, name: t.name }));
  const courses: SeqCourse[] = program.terms.flatMap((t) =>
    t.courses.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      termId: t.id,
      classCount: c.sessions.filter((s) => s.kind === "CLASS").length,
      labCount: c.sessions.filter((s) => s.kind === "LAB").length,
      clinicalCount: c.sessions.filter((s) => s.kind === "CLINICAL").length,
    })),
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/programs/${program.id}`} className="text-sm text-slate-500 hover:text-slate-700">
          ← {program.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Course sequencer</h1>
        <p className="text-sm text-slate-500">
          Drag to re-sequence courses across the {terms.length}-term plan. Changes persist to the program structure and
          flow straight into the capacity engine.
        </p>
      </div>
      <CourseSequencer programId={program.id} terms={terms} initialCourses={courses} />
    </div>
  );
}
