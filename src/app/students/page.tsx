import Link from "next/link";
import { getStudentsDirectory } from "@/lib/queries";
import { StudentDirectory } from "@/components/StudentDirectory";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  const { students, institutions } = await getStudentsDirectory();
  const enrolled = students.filter((s) => s.status === "enrolled").length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
          <p className="text-sm text-slate-500">{students.length} students across every program · {enrolled} enrolled now.</p>
        </div>
        <Link href="/students/analytics" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Learner analytics →</Link>
      </div>
      <StudentDirectory students={students} institutions={institutions} />
    </div>
  );
}
