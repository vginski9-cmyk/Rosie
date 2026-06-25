import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramFull } from "@/lib/queries";
import { CourseSequencer, type SeqCourse, type SeqTerm } from "@/components/CourseSequencer";

export const dynamic = "force-dynamic";

export default async function SequencerPage({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();

  const terms: SeqTerm[] = program.terms.map((t) => ({ id: t.id, name: t.name, courseCount: t.courses.length }));
  const courses: SeqCourse[] = program.terms.flatMap((t) =>
    t.courses.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      termId: t.id,
      requisites: c.requisites,
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
          Drag to re-sequence courses across the {terms.length}-term plan — programs can run anywhere from a single term to
          a dozen. Add or remove terms with the controls below; out-of-order prerequisites are flagged live as you drag.
          Your layout is saved in this browser; the “Save layout” button also persists it to the database when a backend is connected.
        </p>
      </div>

      <CourseSequencer programId={program.id} terms={terms} initialCourses={courses} />
    </div>
  );
}
