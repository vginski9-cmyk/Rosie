import Link from "next/link";
import { getPeopleDirectory } from "@/lib/queries";
import { PeopleDirectory } from "@/components/PeopleDirectory";
import { WorkloadPolicies } from "@/components/WorkloadPolicies";
import { StaffRoles } from "@/components/StaffRoles";
import { Collapse } from "@/components/Collapse";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const { people, institutions, employers, studentCount, policies, roles, assets } = await getPeopleDirectory();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">People</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Faculty, adjuncts, preceptors, supervisors and support staff across every institution — add and manage them here,
          set the workload policies that govern each position, and see how loaded each person is: annual, semester, weekly and
          daily contact hours from every shift they are assigned. Learners have their own hub.
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

      <Collapse title="Workload policies & assumptions" sub="By institution, by partner employer, by position — full load in contact hours per week, the work week, how many work hours each contact hour is credited, and the weeks in a term and a year. Every assignment's load is figured from the person's policy." summary={<>{policies.length} coded polic{policies.length === 1 ? "y" : "ies"}</>}>
        <WorkloadPolicies policies={policies} institutions={institutions} employers={employers} assets={assets} roles={roles} />
      </Collapse>
      <Collapse title="Staff roles" sub="The five built-in roles plus any this institution uses — each role says what it covers on a shift, so custom roles count toward faculty, preceptor or support coverage" summary={<>{roles.length} custom role{roles.length === 1 ? "" : "s"}</>}>
        <StaffRoles roles={roles} institutions={institutions} />
      </Collapse>

      <PeopleDirectory people={people} institutions={institutions} employers={employers} roles={roles} assets={assets} />
    </div>
  );
}
