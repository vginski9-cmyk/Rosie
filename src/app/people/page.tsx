import { getPeopleDirectory } from "@/lib/queries";
import { PeopleDirectory } from "@/components/PeopleDirectory";
import { WorkloadPolicies } from "@/components/WorkloadPolicies";
import { StaffRoles } from "@/components/StaffRoles";
import { Collapse } from "@/components/Collapse";

export const dynamic = "force-dynamic";

// PEOPLE — faculty, adjuncts, preceptors, supervisors and support staff, and how loaded each is.
export default async function PeoplePage() {
  const { people, institutions, employers, policies, roles, assets } = await getPeopleDirectory();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">People</h1>
        <p className="text-sm text-slate-500">{people.filter((p) => p.active).length} active people. Students have their own page.</p>
      </div>
      <PeopleDirectory people={people} institutions={institutions} employers={employers} roles={roles} assets={assets} />
      <Collapse title="Workload policies" sub="Full load in contact hours per week, the work week and the weeks in a term — by institution, employer and position" summary={<>{policies.length} polic{policies.length === 1 ? "y" : "ies"}</>}>
        <WorkloadPolicies policies={policies} institutions={institutions} employers={employers} assets={assets} roles={roles} />
      </Collapse>
      <Collapse title="Staff roles" sub="The built-in roles plus any this institution uses, and what each covers on a shift" summary={<>{roles.length} custom role{roles.length === 1 ? "" : "s"}</>}>
        <StaffRoles roles={roles} institutions={institutions} />
      </Collapse>
    </div>
  );
}
