import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramFull } from "@/lib/queries";
import { addTerm, deleteTerm } from "@/lib/actions";
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
          a dozen. Add or remove terms below; out-of-order prerequisites are flagged live as you drag.
        </p>
      </div>

      {/* Term controls — add / remove (a term can be removed only once empty) */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Terms ({terms.length})</span>
        {program.terms.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs ring-1 ring-slate-200">
            {t.name}
            {t.courses.length === 0 ? (
              <form action={deleteTerm.bind(null, t.id, program.id)}>
                <button className="text-slate-300 hover:text-rose-600" title="remove empty term">✕</button>
              </form>
            ) : (
              <span className="text-slate-300" title={`${t.courses.length} courses — move them out to remove`}>{t.courses.length}</span>
            )}
          </span>
        ))}
        <form action={addTerm.bind(null, program.id)} className="ml-auto">
          <button className="btn-primary text-xs">+ Add term</button>
        </form>
        {terms.length >= 12 && <span className="text-[11px] text-amber-600">12-term practical cap reached</span>}
      </div>

      <CourseSequencer programId={program.id} terms={terms} initialCourses={courses} />
    </div>
  );
}
