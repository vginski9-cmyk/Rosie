import { getStudentsDirectory } from "@/lib/queries";
import { StudentDirectory } from "@/components/StudentDirectory";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  const { students, institutions } = await getStudentsDirectory();
  const enrolled = students.filter((s) => s.status === "enrolled").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The institution-wide directory — every student across every program. Search and filter the pipeline, open a profile
          to see their progression and manage their assignment, or <strong>enroll a new student</strong> straight into a
          program and cohort. {students.length} students · {enrolled} currently enrolled.
        </p>
      </div>
      <StudentDirectory students={students} institutions={institutions} />
    </div>
  );
}
