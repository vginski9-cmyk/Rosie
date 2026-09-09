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
  }));

  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Students <span className="text-sm font-normal text-slate-400">— {students.length} in the pipeline; click a stage to drill in</span></h2>
          </div>
        </div>
      </div>

      <StudentRoster programId={program.id} students={roster} />
    </div>
  );
}
