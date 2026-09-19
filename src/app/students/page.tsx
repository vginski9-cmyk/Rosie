import Link from "next/link";
import { getStudentsDirectory } from "@/lib/queries";
import { StudentDirectory } from "@/components/StudentDirectory";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  const { students, institutions } = await getStudentsDirectory();
  const enrolled = students.filter((s) => s.status === "enrolled").length;
  return (
    <div className="space-y-4">
      <PageHeader title="Students" lede="An imported record, read as evidence." meta={<>{students.length} students across every program · {enrolled} enrolled now</>} actions={<Link href="/students/analytics" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Learner analytics →</Link>} />
      <StudentDirectory students={students} institutions={institutions} />
    </div>
  );
}
