import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCalendarProvenance } from "@/lib/queries";
import { provisionalVerdict } from "@/lib/evidence";
import { fmt } from "@/lib/format";
import { OPERATIONAL } from "@/lib/mode";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

// CAPACITY (Phase 13) — the five kinds of capacity that constrain expansion, each with its headline
// figures and the diagnostic drill-downs beneath it. The drill-downs are the analysis pages that
// already existed under Insights; this hub replaces the generic pivot as the way in.

export default async function CapacityPage({ searchParams }: { searchParams: { inst?: string } }) {
  const instId = searchParams.inst && searchParams.inst !== "all" ? searchParams.inst : undefined;
  const where = instId ? { institutionId: instId } : {};
  const q = (href: string) => (instId ? `${href}?inst=${instId}` : href);
  const [instructors, preceptors, sitesSecured, sitesTotal, assets, rooms, roomsNoHours, equipment, policies, planned, students, assumptions, verifiedAssumptions, reqSets, provenance, sitesEstimate] = await Promise.all([
    prisma.person.count({ where: { ...where, active: true, role: "instructor" } }),
    prisma.person.count({ where: { ...where, active: true, role: "preceptor" } }),
    prisma.familySite.count({ where: { agreementStatus: "secured", ...(instId ? { family: { institutionId: instId } } : {}) } }),
    prisma.employer.count({ where }),
    prisma.clinicalAsset.count({ where: { status: { not: "archived" }, ...(instId ? { employer: { institutionId: instId } } : {}) } }),
    prisma.facility.count({ where: { ...where, status: "active" } }),
    prisma.facility.count({ where: { ...where, status: "active", openHours: { none: {} } } }),
    prisma.equipment.count({ where }),
    prisma.workloadPolicy.count({ where }),
    prisma.cohort.count({ where: { status: { in: ["planned", "active"] }, ...(instId ? { program: { institutionId: instId } } : {}) } }),
    prisma.student.count({ where: { status: "enrolled", ...(instId ? { program: { institutionId: instId } } : {}) } }),
    prisma.assumption.count(),
    prisma.assumption.count({ where: { status: "verified" } }),
    prisma.clinicalRequirementSet.findMany({ select: { verified: true, family: { select: { institutionId: true } } } }),
    getCalendarProvenance(instId),
    prisma.familySite.count({ where: { agreementStatus: "secured", staffCountSource: { not: "VERIFIED" }, ...(instId ? { family: { institutionId: instId } } : {}) } }),
  ]);
  const req = reqSets.filter((r) => !instId || r.family.institutionId === instId);
  const unverifiedStandards = req.filter((r) => !r.verified).length;
  const calendars = provenance.institutions.map((i) => ({ ...i, verdict: provisionalVerdict(i) }));
  const provisional = calendars.filter((c) => c.verdict.level !== "ok");

  const Area = ({ title, sub, headline, links }: { title: string; sub: string; headline: React.ReactNode; links: [string, string, string][] }) => (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="text-xs text-slate-500">{sub}</p>
      <div className="mt-2 text-sm text-slate-800">{headline}</div>
      <ul className="mt-3 space-y-1 text-xs">
        {links.map(([label, href, what]) => <li key={href}><Link href={href} className="font-medium text-rose-700 hover:underline">{label} →</Link> <span className="text-slate-500">{what}</span></li>)}
      </ul>
    </section>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={<>Capacity</>} lede={<>What constrains expansion: the people, the clinical seats, the rooms, the pipeline, and how well each is known.</>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Area title="Staffing capacity" sub="Qualified faculty hours and precepted shifts, against what every planned offering needs in its peak week"
          headline={<>{fmt.num(instructors)} active instructors · {fmt.num(preceptors)} preceptors at partner sites · {fmt.num(policies)} workload polic{policies === 1 ? "y" : "ies"} turning assigned contact hours into load</>}
          links={[["Instructors & preceptors needed", q("/insights/staffing-need"), "FTE demanded by week, who fills it, and the gap"], ["People", q("/people"), "the roster of faculty, adjuncts and preceptors — an imported input"], ["Workload policies", "/setup#people", "contact hours per week, work week, term weeks"]]} />
        <Area title="Clinical capacity" sub="Learner seats on a date, shift and setting at sites with a secured agreement; the experiences each site confirms"
          headline={<>{fmt.num(sitesSecured)} secured program–site agreements across {fmt.num(sitesTotal)} partner organizations · {fmt.num(assets)} physical assets a learner can be placed on · {fmt.num(planned)} offerings planned or running</>}
          links={[["Clinical site capacity", q("/insights/clinical-sites"), "the per-date ceiling of hostable seats"], ["Clinical scheduler", q("/scheduler"), `every dated shift placed on supply — the readiness funnel${OPERATIONAL ? "" : " (read-only: the strategic product does not write plans)"}`], ["Clinical site load", q("/insights/site-load"), "actual student-shifts by site, including completed cohorts"], ["Daily coverage", q("/insights/coverage"), "who is where, day by day"], ["Sites & requirements by program", "/clinical", "agreements, experience confirmations, accreditor requirement sets"], ["Map", q("/insights/map"), "campuses and booked sites"]]} />
        <Area title="Facilities & equipment capacity" sub="Lab and classroom hours in the peak week, and equipment units per learner"
          headline={<>{fmt.num(rooms)} rooms{roomsNoHours ? <span className="text-amber-700"> · {fmt.num(roomsNoHours)} without coded open hours</span> : null} · {fmt.num(equipment)} equipment records</>}
          links={[["Room utilization", q("/utilization"), "booked hours against open hours, by room"], ["Asset supply", q("/supply"), "seats per shift at every site asset, by setting"], ["Rooms, buildings & equipment", "/setup#rooms", "the mapped inventory and its open hours"]]} />
        <Area title="Pipeline capacity" sub="Applicants, enrolment, completion, licensure and placement — the ladder from interest to a productive worker"
          headline={<>{fmt.num(students)} students enrolled now · the goal ladder for each program works the {new Date().getUTCFullYear() + 3} target back to the seats it needs</>}
          links={[["Programs", "/programs", "each program's goal & pipeline planner"], ["Learner analytics", "/students/analytics", "completion and withdrawal by cohort and demographic — a diagnostic drill-down"], ["Semester view", q("/semester"), "what runs when"]]} />
        <div className="lg:col-span-2">
          <Area title="Evidence & uncertainty" sub="How well the inputs behind every answer are known: verified, estimated or defaulted"
            headline={<>{fmt.num(verifiedAssumptions)} of {fmt.num(assumptions)} registry assumptions verified · {fmt.num(unverifiedStandards)} of {fmt.num(req.length)} accreditor requirement sets unverified · {fmt.num(sitesEstimate)} secured sites without a verified staff-on-shift figure · {provisional.length ? <span className="text-amber-700">{provisional.map((c) => `${c.name}: ${c.verdict.level === "provisional" ? "term dates provisional" : "some term dates set by hand"}`).join(" · ")}</span> : "term dates from the college calendars"}</>}
            links={[["Evidence review", "/setup#evidence", "every unverified input, where it is used, and where it gets confirmed"], ["Planning assumptions", "/setup#assumptions", "the registry: value, range, source, owner, status, review date"], ["Exceptions", "/setup/exceptions", "the operational blocker queue — over-capacity days, unsecured placements, holiday sessions"]]} />
        </div>
      </div>
    </div>
  );
}
