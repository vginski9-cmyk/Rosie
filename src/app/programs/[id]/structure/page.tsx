import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getProgramFull } from "@/lib/queries";
import { ProgramDesigner, type DTerm } from "@/components/ProgramDesigner";

export const dynamic = "force-dynamic";

export default async function StructureEditor({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();
  const library = await prisma.skill.findMany({ where: { institutionId: program.institutionId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const defaultEnrollment = Math.round(program.defaultCohortSeats ?? Math.max(0, ...program.yearTargets.map((t) => t.cohortCapacity ?? 0)) ?? 40);

  const terms: DTerm[] = program.terms.map((t) => ({
    id: t.id, name: t.name, index: t.index, startWeek: t.startWeek, endWeek: t.endWeek,
    courses: t.courses.map((c) => ({
      id: c.id, code: c.code, name: c.name, creditHours: c.creditHours,
      weeklyClassHours: c.weeklyClassHours, weeklyLabHours: c.weeklyLabHours, weeklyClinicalHours: c.weeklyClinicalHours,
      semesterOffered: c.semesterOffered, courseType: c.courseType, description: c.description, requisites: c.requisites,
      sessions: c.sessions.map((s) => ({
        id: s.id, kind: s.kind as "CLASS" | "LAB" | "CLINICAL", number: s.number, title: s.title,
        lengthHours: s.lengthHours, maxStudents: s.maxStudents, facultyNeeded: s.facultyNeeded, preceptorsNeeded: s.preceptorsNeeded, supportStaffNeeded: s.supportStaffNeeded,
        week: s.week, dayOfWeek: s.dayOfWeek, startTime: s.startTime, location: s.location,
        homework: s.homework, rotationType: s.rotationType, clinicalMode: s.clinicalMode,
        skills: s.skillLinks.map((l) => ({ skillId: l.skillId, name: l.skill.name, mode: l.mode })),
      })),
      courseSkills: c.courseSkills.map((cs) => ({ id: cs.id, skillId: cs.skillId, name: cs.skill.name, targetLevel: cs.targetLevel, role: cs.role })),
    })),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Program &amp; course design</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The <strong>timeless template</strong>: terms, courses, and the session-by-session experience — what&apos;s taught,
          when in the week, where, how long, capacity, faculty/preceptors required, and the KSAs each session develops or
          assesses. Everything&apos;s open and editable inline; the enrollment slider shows how the delivery footprint scales.
          No instructors or students — those live on a <Link href={`/programs/${program.id}`} className="text-rose-700 hover:underline">scheduled offering</Link>.
          Use the sticky bar to jump between terms, collapse what you&apos;re not editing, or open <strong>⇄ Re-sequence</strong> to drag courses across terms.
        </p>
      </div>

      <ProgramDesigner programId={program.id} terms={terms} library={library} defaultEnrollment={defaultEnrollment} />
    </div>
  );
}
