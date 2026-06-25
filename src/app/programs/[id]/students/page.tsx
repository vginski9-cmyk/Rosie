import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramStudents } from "@/lib/queries";
import { StudentRoster, type RosterStudent } from "@/components/StudentRoster";

export const dynamic = "force-dynamic";

export default async function ProgramStudentsPage({ params }: { params: { id: string } }) {
  const data = await getProgramStudents(params.id);
  if (!data) notFound();
  const { program, students } = data;

  const roster: RosterStudent[] = students.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    status: s.status,
    stageKey: s.stageKey,
    gpa: s.gpa,
    attendedCount: s.attendedCount,
    missedCount: s.missedCount,
    grades: s._count.grades,
    assessments: s._count.assessments,
  }));

  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
            <p className="text-sm text-slate-500">{program.institution.name} · {program.name} · {students.length} people in the pipeline · click a stage to drill in</p>
          </div>
        </div>
      </div>

      <StudentRoster programId={program.id} students={roster} />
    </div>
  );
}
