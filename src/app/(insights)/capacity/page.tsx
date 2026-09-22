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
  const [instructors, preceptors, sitesSecured, sitesTotal, assets, rooms, roomsNoHours, equipment, policies, planned, graduated, students, assumptions, verifiedAssumptions, reqSets, provenance, sitesEstimate] = await Promise.all([
    prisma.person.count({ where: { ...where, active: true, role: "instructor" } }),
    prisma.person.count({ where: { ...where, active: true, role: "preceptor" } }),
    prisma.familySite.count({ where: { agreementStatus: "secured", ...(instId ? { family: { institutionId: instId } } : {}) } }),
    prisma.employer.count({ where }),
    prisma.clinicalAsset.count({ where: { status: { not: "archived" }, ...(instId ? { employer: { institutionId: instId } } : {}) } }),
    prisma.facility.count({ where: { ...where, status: "active" } }),
    prisma.facility.count({ where: { ...where, status: "active", openHours: { none: {} } } }),
    prisma.equipment.count({ where }),
    prisma.workloadPolicy.count({ where }),
    prisma.cohort.count({ where: { status: { not: "archived" }, cohortTerms: { some: { endDate: { gte: new Date() } } }, ...(instId ? { program: { institutionId: instId } } : {}) } }),
    prisma.cohort.count({ where: { status: "completed", ...(instId ? { program: { institutionId: instId } } : {}) } }),
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
      <PageHeader title={<>Capacity</>} lede={<>The people, clinical seats, rooms and pipeline that limit how many students can run.</>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Area title="Staffing" sub="Instructors and preceptors against what every offering needs"
          headline={<>{fmt.num(instructors)} instructors · {fmt.num(preceptors)} preceptors · {fmt.num(policies)} workload polic{policies === 1 ? "y" : "ies"}</>}
          links={[["Instructors & preceptors needed", q("/insights/staffing-need"), "by week, who fills it, and the gap"], ["People", q("/people"), "the roster"], ["Workload policies", "/setup#people", "contact hours per week"]]} />
        <Area title="Clinical seats" sub="Where students can be placed, and how much room there is"
          headline={<>{fmt.num(sitesSecured)} secured agreements at {fmt.num(sitesTotal)} sites · {fmt.num(assets)} placeable assets · {fmt.num(planned)} offerings in session or ahead · {fmt.num(graduated)} graduated</>}
          links={[["Clinical scheduler", q("/scheduler"), `supply against demand, shift by shift${OPERATIONAL ? "" : " (read-only)"}`], ["Clinical site capacity", q("/insights/clinical-sites"), "seats a site can host on a date"], ["Clinical site load", q("/insights/site-load"), "student-shifts by site"], ["Daily coverage", q("/insights/coverage"), "who is where, day by day"], ["Sites by program", "/clinical", "agreements and requirements"], ["Map", q("/insights/map"), "campuses and booked sites"]]} />
        <Area title="Rooms & equipment" sub="Lab and classroom hours, and equipment per student"
          headline={<>{fmt.num(rooms)} rooms{roomsNoHours ? <span className="text-amber-700"> · {fmt.num(roomsNoHours)} without open hours</span> : null} · {fmt.num(equipment)} equipment records</>}
          links={[["Room utilization", q("/utilization"), "booked hours against open hours"], ["Asset supply", q("/supply"), "seats per shift at every site asset"], ["Rooms, buildings & equipment", "/setup#rooms", "the inventory and its open hours"]]} />
        <Area title="Pipeline" sub="From applicant to productive worker"
          headline={<>{fmt.num(students)} students enrolled now</>}
          links={[["Programs", "/programs", "each program's goal and pipeline"], ["Learner analytics", "/students/analytics", "completion and withdrawal by cohort"], ["Semester view", q("/semester"), "what runs when"]]} />
        <div className="lg:col-span-2">
          <Area title="How well the inputs are known" sub="Verified, estimated or defaulted"
            headline={<>{fmt.num(verifiedAssumptions)} of {fmt.num(assumptions)} assumptions verified · {fmt.num(unverifiedStandards)} of {fmt.num(req.length)} requirement sets unverified · {fmt.num(sitesEstimate)} secured sites with an estimated staff figure · {provisional.length ? <span className="text-amber-700">{provisional.map((c) => `${c.name}: ${c.verdict.level === "provisional" ? "term dates provisional" : "some term dates set by hand"}`).join(" · ")}</span> : "term dates from the college calendars"}</>}
            links={[["Evidence review", "/setup#evidence", "every unverified input"], ["Planning assumptions", "/setup#assumptions", "the registry"], ["Exceptions", "/setup/exceptions", "what the records raise"]]} />
        </div>
      </div>
    </div>
  );
}
