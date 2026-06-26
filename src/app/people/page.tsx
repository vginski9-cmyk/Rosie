import Link from "next/link";
import { getPeopleDirectory } from "@/lib/queries";
import { PeopleDirectory } from "@/components/PeopleDirectory";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const { people, institutions, employers, studentCount } = await getPeopleDirectory();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">People</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Faculty, preceptors, supervisors, and support staff across every institution — add and manage them here, and see
          how loaded each one is. Learners have their own hub.
        </p>
      </div>

      {/* Learners cross-link — students are people too, managed in their own workspace */}
      <Link href="/students" className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 hover:border-rose-200 hover:bg-rose-50/40">
        <div>
          <div className="text-sm font-semibold text-slate-800">Students &amp; learners ↦</div>
          <div className="text-xs text-slate-500">{studentCount} students — enroll, intake, and assign in the Students workspace</div>
        </div>
        <span className="text-rose-600">→</span>
      </Link>

      <PeopleDirectory people={people} institutions={institutions} employers={employers} />
    </div>
  );
}
