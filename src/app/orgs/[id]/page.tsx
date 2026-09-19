import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getOrganization, getWorkloadPolicies, getInstitutionsLite, getStaffRoles, getAssetsLite, getRoomsWorkspace, getCalendarProvenance } from "@/lib/queries";
import { updateInstitution, updateInstitutionGeography } from "@/lib/actions";
import { AcademicCalendar } from "@/components/AcademicCalendar";
import { WorkloadPolicies } from "@/components/WorkloadPolicies";
import { StaffRoles } from "@/components/StaffRoles";
import { RoomsWorkspace } from "@/components/RoomsWorkspace";
import { Collapse } from "@/components/Collapse";
import { ExceptionQueue } from "@/components/ExceptionQueue";
import { getExceptionQueue } from "@/lib/exceptions";
import { provisionalVerdict } from "@/lib/evidence";
import { scopeOf } from "@/lib/assumptions";
import { OPERATIONAL } from "@/lib/mode";
import { dec, fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

// SETUP for one institution (Phase 13) — five jobs, in order: the CONNECTIONS the records come in
// through, the MAPPINGS that place those records on the model (campus, rooms, sites and assets,
// people and policies, programs), the planning ASSUMPTIONS, the EVIDENCE REVIEW of what is verified
// and what is only estimated, and the EXCEPTIONS the records raise. The operational records
// themselves (students, people, the calendar, the scheduler) are linked as drill-downs at the end.

const ROLE_LABEL: Record<string, string> = { instructor: "Faculty", preceptor: "Preceptors", support: "Support staff", supervisor: "Supervisors", coordinator: "Coordinators" };
const AGREE_LABEL: Record<string, string> = { secured: "secured", asked: "asked", prospect: "prospect", none: "no agreement" };

export default async function OrganizationPage({ params }: { params: { id: string } }) {
  const [data, policies, institutions, rolesRaw, assetsLite, ws, exceptionsAll, provenance] = await Promise.all([getOrganization(params.id), getWorkloadPolicies(), getInstitutionsLite(), getStaffRoles(), getAssetsLite(), getRoomsWorkspace(params.id), getExceptionQueue(), getCalendarProvenance(params.id)]);
  if (!data) notFound();
  const { inst, assets, employersLite } = data;
  const familyIds = inst.programFamilies.map((f) => f.id);
  const programIds = inst.programFamilies.flatMap((f) => f.programs.map((p) => p.id));
  const [assumptionRows, reqSets, sitesEstimate, sitesSecured, assetsEstimate, assetsTotal, students, cohorts, scenarios] = await Promise.all([
    prisma.assumption.findMany({ where: { scope: { in: [scopeOf.global, scopeOf.institution(inst.id), ...familyIds.map((id) => scopeOf.family(id)), ...programIds.map((id) => scopeOf.program(id))] } }, select: { scope: true, status: true, reviewBy: true } }),
    prisma.clinicalRequirementSet.findMany({ where: { familyId: { in: familyIds } }, select: { id: true, familyId: true, authority: true, verified: true, family: { select: { name: true, programs: { select: { id: true }, take: 1 } } } } }),
    prisma.familySite.count({ where: { familyId: { in: familyIds }, agreementStatus: "secured", staffCountSource: { not: "VERIFIED" } } }),
    prisma.familySite.count({ where: { familyId: { in: familyIds }, agreementStatus: "secured" } }),
    prisma.clinicalAsset.count({ where: { employer: { institutionId: inst.id }, status: { not: "archived" }, dataSource: { not: "VERIFIED" } } }),
    prisma.clinicalAsset.count({ where: { employer: { institutionId: inst.id }, status: { not: "archived" } } }),
    prisma.student.count({ where: { programId: { in: programIds } } }),
    prisma.cohort.count({ where: { programId: { in: programIds } } }),
    prisma.scenario.count({ where: { institutionId: inst.id } }),
  ]);
  const roles = rolesRaw.map((r) => ({ id: r.id, institutionId: r.institutionId, institution: r.institution.name, key: r.key, label: r.label, family: r.family, notes: r.notes }));
  const codedStarts = inst.academicEvents.filter((e) => e.kind === "term_start");
  const holidays = inst.academicEvents.filter((e) => e.kind === "holiday").length;
  const agree = new Map<string, number>(); for (const e of inst.employers) agree.set(e.agreementStatus, (agree.get(e.agreementStatus) ?? 0) + 1);
  const peopleByRole = new Map<string, number>(); for (const p of inst.people) if (p.active) peopleByRole.set(p.role, (peopleByRole.get(p.role) ?? 0) + 1);
  const ownPolicies = policies.filter((p) => p.institutionId === inst.id);
  const mainCampus = inst.campuses[0] ?? null;
  const located = inst.employers.filter((e) => e.driveMinutes != null).length;
  const RING_TONE: Record<string, string> = { Core: "bg-emerald-100 text-emerald-800", "Ring 1": "bg-sky-100 text-sky-800", "Ring 2": "bg-amber-100 text-amber-800", "Ring 3": "bg-rose-100 text-rose-800" };
  const programs = inst.programFamilies.reduce((n, f) => n + f.programs.length, 0);
  const exceptions = exceptionsAll.filter((x) => x.institutionId === inst.id || x.institutionId == null);
  const blockers = exceptions.filter((x) => x.severity === "blocker").length;
  const dates = provisionalVerdict(provenance.all);
  const todayIso = new Date().toISOString().slice(0, 10);
  const ownAssumptions = assumptionRows.filter((r) => r.scope !== scopeOf.global);
  const verifiedAssumptions = ownAssumptions.filter((r) => r.status === "verified").length;
  const staleAssumptions = assumptionRows.filter((r) => r.reviewBy && r.reviewBy.toISOString().slice(0, 10) < todayIso).length;
  const unverifiedSets = reqSets.filter((r) => !r.verified);
  const evidenceItems = [
    { ok: dates.level === "ok", label: dates.level === "ok" ? "Term dates come from the imported college calendar" : dates.level === "hand-set" ? dates.text : "Term dates are provisional — no college calendar imported", href: "#connections", fix: "import the academic calendar" },
    { ok: unverifiedSets.length === 0, label: unverifiedSets.length === 0 ? `${fmt.num(reqSets.length)} accreditor requirement set${reqSets.length === 1 ? "" : "s"} verified` : `${fmt.num(unverifiedSets.length)} of ${fmt.num(reqSets.length)} accreditor requirement sets are starter content, not verified`, href: unverifiedSets[0]?.family.programs[0] ? `/programs/${unverifiedSets[0].family.programs[0].id}/clinical` : "/clinical", fix: "verify the list against the credentialing body's current edition" },
    { ok: sitesEstimate === 0, label: sitesEstimate === 0 ? `every secured site has a verified staff-on-shift figure` : `${fmt.num(sitesEstimate)} of ${fmt.num(sitesSecured)} secured program–site agreements carry an estimated staff-on-shift figure`, href: "/clinical", fix: "record the site's qualified staff on shift as verified" },
    { ok: assetsEstimate === 0, label: assetsEstimate === 0 ? `every clinical asset is verified with its site` : `${fmt.num(assetsEstimate)} of ${fmt.num(assetsTotal)} clinical assets (halls, rooms, slots) are estimates, not confirmed with the site`, href: "/clinical", fix: "confirm seats per shift with each site" },
    { ok: ownAssumptions.length > 0 && verifiedAssumptions === ownAssumptions.length, label: ownAssumptions.length === 0 ? "no planning assumption has been set for this college — every answer rests on workspace defaults" : `${fmt.num(verifiedAssumptions)} of ${fmt.num(ownAssumptions.length)} college, family and program assumptions verified${staleAssumptions ? ` · ${fmt.num(staleAssumptions)} past review` : ""}`, href: `/orgs/${inst.id}/assumptions`, fix: "set the college's own figure, its owner and review date" },
  ];
  const steps = [
    { label: "Connections", ok: codedStarts.length > 0, href: "#connections" },
    { label: "Mappings", ok: !!(inst.kind && inst.city) && ws.rooms.length > 0 && inst.employers.length > 0 && inst.people.length > 0 && programs > 0, href: "#mappings" },
    { label: "Assumptions", ok: ownAssumptions.length > 0, href: "#assumptions" },
    { label: "Evidence review", ok: evidenceItems.every((e) => e.ok), href: "#evidence" },
    { label: "Exceptions", ok: blockers === 0, href: "#exceptions" },
  ];
  const inp = "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm";
  const lbl = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">← Home</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{inst.name} — setup</h1>
            <p className="text-sm text-slate-500">{[inst.kind, [inst.city, inst.state].filter(Boolean).join(", "), inst.serviceArea].filter(Boolean).join(" · ")}</p>
          </div>
          <span className="flex flex-wrap gap-3 text-sm"><Link href={`/orgs/${inst.id}/assumptions`} className="text-rose-600 hover:underline">Planning assumptions →</Link><Link href="/setup/exceptions" className="text-rose-600 hover:underline">All exceptions →</Link></span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {steps.map((s) => <a key={s.label} href={s.href} className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-50 text-amber-800 ring-1 ring-amber-200"}`}>{s.ok ? "✓" : "○"} {s.label}</a>)}
        </div>
      </div>

      {/* 1 · Connections & imports */}
      <section id="connections" className="scroll-mt-16 space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">1 · Connections &amp; imports</h2>
          <p className="text-xs text-slate-500">Where the records come from. Rosie reads the college&apos;s calendar, program sheets, clinical asset maps, rosters and staffing as imported actuals; none of it is typed here.</p>
        </div>
        <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          {([
            ["Academic calendar", codedStarts.length ? `${fmt.num(codedStarts.length)} coded term starts · ${fmt.num(holidays)} holidays` : "not imported — dates provisional", codedStarts.length > 0, "#calendar", "paste or upload the college's academic calendar"],
            ["Program sheets", `${fmt.num(programs)} program${programs === 1 ? "" : "s"} · the design workbook per program`, programs > 0, programs ? `/programs/${programIds[0]}/structure` : "/programs", "import a program's design sheet on its Design & sequence page"],
            ["Clinical asset maps", `${fmt.num(assetsTotal)} assets at ${fmt.num(inst.employers.length)} sites`, assetsTotal > 0, "/clinical", "import the supply map on the program's clinical pages"],
            ["Student & staffing systems", `${fmt.num(students)} student records · ${fmt.num(cohorts)} offerings · ${fmt.num(inst.people.filter((p) => p.active).length)} people`, students > 0 || inst.people.length > 0, OPERATIONAL ? "/students" : "#operational", OPERATIONAL ? "the operational module edits these" : "read-only actuals in the strategic product"],
          ] as [string, string, boolean, string, string][]).map(([label, sub, ok, href, what]) => (
            <Link key={label} href={href} className={`rounded-xl border p-3 hover:border-rose-300 ${ok ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/40"}`}>
              <div className="font-semibold text-slate-800">{ok ? "✓" : "○"} {label}</div>
              <div className="text-slate-600">{sub}</div>
              <div className="mt-1 text-[11px] text-slate-400">{what}</div>
            </Link>
          ))}
        </div>
        <div id="calendar" className="scroll-mt-16">
          <AcademicCalendar
            title="Academic calendar — imported" institutionId={inst.id} institutionName={inst.name} familyId=""
            anchors={{ springStart: inst.springStart, summerStart: inst.summerStart, fallStart: inst.fallStart }}
            coded={inst.academicEvents.map((e) => ({ id: e.id, iso: e.date.toISOString().slice(0, 10), endIso: e.endDate?.toISOString().slice(0, 10) ?? null, label: e.label, kind: e.kind, season: e.season }))}
          />
        </div>
      </section>

      {/* 2 · Mappings */}
      <section id="mappings" className="scroll-mt-16 space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">2 · Mappings</h2>
          <p className="text-xs text-slate-500">How the imported records sit on the model: the campus and its drive-time rings, rooms and equipment with open hours, partner sites and the assets a learner can be placed on, people with their roles and workload policies, and the programs built on all of it.</p>
        </div>
        <div id="basics">
          <Collapse title="Basics & geography" sub="Name, type, home city, service area, the main campus and the drive-time rings every site is banded by" summary={<>{inst.shortName ?? inst.name}{inst.kind ? ` · ${inst.kind}` : ""} · {mainCampus?.lat != null ? "campus located" : "campus not located"} · rings {inst.ringCoreMinutes}/{inst.ringOneMinutes}/{inst.ringTwoMinutes} min</>}>
            <form action={updateInstitution.bind(null, inst.id)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block"><span className={lbl}>Name</span><input name="name" defaultValue={inst.name} required className={inp} /></label>
              <label className="block"><span className={lbl}>Short name</span><input name="shortName" defaultValue={inst.shortName ?? ""} className={inp} /></label>
              <label className="block"><span className={lbl}>Kind</span><select name="kind" defaultValue={inst.kind ?? ""} className={inp}><option value="">—</option><option>Community college</option><option>University</option><option>Health system</option><option>Career center</option><option>Other</option></select></label>
              <label className="block"><span className={lbl}>City</span><input name="city" defaultValue={inst.city ?? ""} className={inp} /></label>
              <label className="block"><span className={lbl}>State</span><input name="state" defaultValue={inst.state ?? "NC"} className={inp} /></label>
              <label className="block"><span className={lbl}>Service area</span><input name="serviceArea" defaultValue={inst.serviceArea ?? ""} placeholder="counties / region the goals cover" className={inp} /></label>
              <div className="flex items-end"><button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Save basics</button></div>
            </form>
            <form action={updateInstitutionGeography.bind(null, inst.id)} className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Main campus &amp; drive-time rings <span className="font-normal normal-case text-slate-400">— every site&apos;s ring follows its drive time from this address</span></div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                <label className="block lg:col-span-2"><span className={lbl}>Campus street address</span><input name="campusAddress" defaultValue={mainCampus?.address ?? ""} placeholder="3395 Airport Rd" className={inp} /></label>
                <label className="block"><span className={lbl}>City</span><input name="campusCity" defaultValue={mainCampus?.city ?? inst.city ?? ""} className={inp} /></label>
                <label className="block"><span className={lbl}>ZIP</span><input name="campusZip" defaultValue={mainCampus?.zip ?? ""} className={inp} /></label>
                <div className="lg:col-span-2 text-xs text-slate-500">
                  {mainCampus ? <>{mainCampus.name}{mainCampus.lat != null ? <> · located {mainCampus.geoSource === "census" ? "street-level (Census)" : mainCampus.geoSource === "gazetteer" ? "at the town centre (built-in gazetteer)" : "by hand"} · <span className="font-mono">{dec(mainCampus.lat, 4)}, {mainCampus.lng != null ? dec(mainCampus.lng, 4) : ""}</span></> : <span className="text-amber-700"> · not located yet</span>}</> : <span className="text-amber-700">No campus yet — saving creates one.</span>}
                </div>
                <label className="block"><span className={lbl}>Core ≤ minutes</span><input name="ringCoreMinutes" type="number" min={1} defaultValue={inst.ringCoreMinutes} className={inp} /></label>
                <label className="block"><span className={lbl}>Ring 1 ≤ minutes</span><input name="ringOneMinutes" type="number" min={1} defaultValue={inst.ringOneMinutes} className={inp} /></label>
                <label className="block"><span className={lbl}>Ring 2 ≤ minutes</span><input name="ringTwoMinutes" type="number" min={1} defaultValue={inst.ringTwoMinutes} className={inp} /></label>
                <div className="text-xs text-slate-500 lg:col-span-2">Ring 3 is everything beyond Ring 2; drive time is an estimate for banding, not a route.</div>
                <div className="flex items-end"><button className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700">Save &amp; recompute drive times</button></div>
              </div>
            </form>
          </Collapse>
        </div>
        <div id="rooms" className="scroll-mt-16">
          <Collapse title="Campuses, buildings, rooms & equipment" sub="Campus → building → room, each room with coded open hours; equipment fixed, mobile or portable, assignable to rooms" summary={<>{ws.campuses.length} campus{ws.campuses.length === 1 ? "" : "es"} · {ws.buildings.length} buildings · {ws.rooms.length} rooms · {ws.equipment.reduce((n, e) => n + e.quantity, 0)} pieces of equipment{ws.rooms.some((r) => r.hours.length === 0) ? ` · ⚠ ${ws.rooms.filter((r) => r.hours.length === 0).length} rooms without hours` : ""}</>}>
            <RoomsWorkspace rooms={ws.rooms} campuses={ws.campuses} buildings={ws.buildings} equipment={ws.equipment} institutions={institutions} defaultInstitutionId={inst.id} />
          </Collapse>
        </div>
        <div id="sites" className="scroll-mt-16">
          <Collapse title="Clinical sites & their physical assets" sub="Partner organizations, agreements, and every room, unit and machine a learner can be placed on, by setting — each site auto-located, with its drive from the main campus and its ring" summary={<>{inst.employers.length} sites · {located} located · {assets.reduce((n, a) => n + a.count, 0)} assets · {[...agree.entries()].map(([k, n]) => `${n} ${AGREE_LABEL[k] ?? k}`).join(" · ")}</>}>
            <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Assets by setting</div>
                <table className="mt-1 w-full text-xs"><tbody className="divide-y divide-slate-100">
                  {assets.map((a) => <tr key={a.settingCode}><td className="py-1 font-medium text-slate-700">{a.settingCode}</td><td className="py-1 text-right tabular-nums">{a.count} assets</td><td className="py-1 text-right tabular-nums text-slate-500">{a.learners} learners / shift</td></tr>)}
                  {assets.length === 0 && <tr><td className="py-2 text-slate-400">No assets mapped yet — add them on each site&apos;s page.</td></tr>}
                </tbody></table>
                <div className="mt-2 flex flex-wrap gap-3 text-xs"><Link href="/employers" className="text-rose-600 hover:underline">all partner organizations →</Link><Link href="/clinical" className="text-rose-600 hover:underline">sites & supply by program →</Link><Link href={`/scheduler?inst=${inst.id}`} className="text-rose-600 hover:underline">clinical scheduler (diagnostic) →</Link></div>
              </div>
              <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">Site</th><th className="px-2 py-1.5 text-left">Type</th><th className="px-2 py-1.5 text-left">Ring · drive</th><th className="px-2 py-1.5 text-left">Agreement</th><th className="px-2 py-1.5 text-right">Assets</th><th className="px-2 py-1.5 text-right">Preceptors</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...inst.employers].sort((a, b) => (a.driveMinutes ?? 9e9) - (b.driveMinutes ?? 9e9) || a.name.localeCompare(b.name)).map((e) => <tr key={e.id}><td className="px-3 py-1"><Link href={`/employers/${e.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{e.name}</Link><span className="block text-[10px] text-slate-400">{e.city ?? ""}</span></td><td className="px-2 py-1 text-slate-600">{e.facilityType ?? "—"}</td><td className="px-2 py-1 whitespace-nowrap">{e.ring ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${RING_TONE[e.ring] ?? "bg-slate-100 text-slate-600"}`}>{e.ring}{e.ringSource === "manual" ? " ✎" : ""}</span> : <span className="text-slate-300">—</span>}{e.driveMinutes != null && <span className="ml-1 text-[10px] tabular-nums text-slate-500">≈ {fmt.minutes(e.driveMinutes)}</span>}</td><td className="px-2 py-1"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${e.agreementStatus === "secured" ? "bg-emerald-100 text-emerald-800" : e.agreementStatus === "asked" ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-500"}`}>{AGREE_LABEL[e.agreementStatus] ?? e.agreementStatus}</span></td><td className="px-2 py-1 text-right tabular-nums">{e._count.assets}</td><td className="px-2 py-1 text-right tabular-nums">{e._count.people}</td></tr>)}
                    {inst.employers.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">No clinical sites yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </Collapse>
        </div>
        <div id="people" className="scroll-mt-16">
          <Collapse title="People, staff roles & workload policies" sub="Faculty, adjuncts, support staff, coordinators and the preceptors at partner sites — the roles they map to, and the policies that turn each person's assigned contact hours into load" summary={<>{inst.people.filter((p) => p.active).length} active people · {[...peopleByRole.entries()].map(([k, n]) => `${n} ${(ROLE_LABEL[k] ?? k).toLowerCase()}`).join(" · ")} · {ownPolicies.length} policies</>}>
            <div className="mb-3 flex flex-wrap gap-3 text-xs"><Link href="/people" className="text-rose-600 hover:underline">the people roster (imported record) →</Link></div>
            <div className="mb-3"><div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Staff roles</div><StaffRoles roles={roles} institutions={institutions} defaultInstitutionId={inst.id} /></div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Workload policies</div>
            <WorkloadPolicies policies={policies} institutions={institutions} employers={employersLite} assets={assetsLite} roles={roles} defaultInstitutionId={inst.id} />
          </Collapse>
        </div>
        <div id="programs" className="scroll-mt-16">
          <Collapse title="Programs built on this setup" sub="Each job and the program that delivers it" summary={<>{inst.programFamilies.length} jobs · {programs} programs · {fmt.num(scenarios)} scenarios</>}>
            <div className="space-y-3">
              {inst.programFamilies.map((f) => (
                <div key={f.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-slate-800">{f.occupation?.title ?? f.name}</span>
                    <span className="text-xs text-slate-500">{f.name}{f.occupation ? ` · SOC ${f.occupation.socCode}` : ""}</span>
                  </div>
                  <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-100">
                    {f.programs.map((p) => (
                      <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-sm">
                        <Link href={`/programs/${p.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{p.name}</Link>
                        <span className="text-xs text-slate-500">{p.credential ?? "—"} · {p.programType} · {p._count.terms} terms{p.defaultCohortSeats ? ` · up to ${p.defaultCohortSeats} seats` : ""} · {p._count.cohorts} offering{p._count.cohorts === 1 ? "" : "s"}</span>
                        <span className="ml-auto flex gap-2 text-xs"><Link href={`/programs/${p.id}/structure`} className="text-rose-600 hover:underline">design</Link><Link href={`/programs/${p.id}/clinical`} className="text-rose-600 hover:underline">clinical sites</Link><Link href={`/programs/${p.id}/goal`} className="text-rose-600 hover:underline">goal</Link><Link href={`/programs/${p.id}/expand`} className="text-rose-600 hover:underline">scenarios</Link></span>
                      </div>
                    ))}
                    {f.programs.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No program templates yet.</div>}
                  </div>
                </div>
              ))}
              {inst.programFamilies.length === 0 && <p className="text-sm text-slate-400">No jobs yet — add a North Star goal for this institution on the home page.</p>}
            </div>
          </Collapse>
        </div>
      </section>

      {/* 3 · Assumptions */}
      <section id="assumptions" className="scroll-mt-16 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">3 · Planning assumptions</h2>
          <Link href={`/orgs/${inst.id}/assumptions`} className="text-sm text-rose-600 hover:underline">open the registry →</Link>
        </div>
        <p className="text-xs text-slate-500">The rates, lags, lead times, costs and workload figures every scenario rests on, with a value, range, source, owner, status and review date each. The most specific scope wins: program over job family over college over workspace.</p>
        <p className="mt-2 text-sm text-slate-800">{ownAssumptions.length === 0 ? <span className="text-amber-700">No figure set for this college yet — every scenario here rests on workspace defaults, which are labelled as defaults, never as verified.</span> : <>{fmt.num(ownAssumptions.length)} figures set at the college, family or program scope · {fmt.num(verifiedAssumptions)} verified{staleAssumptions ? <span className="text-rose-700"> · {fmt.num(staleAssumptions)} past their review date</span> : null}</>}</p>
      </section>

      {/* 4 · Evidence review */}
      <section id="evidence" className="scroll-mt-16 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">4 · Evidence review</h2>
        <p className="text-xs text-slate-500">What is verified and what is only estimated or defaulted, in the inputs the answers rest on. An estimate counts as potential, never as confirmed capacity.</p>
        <ul className="mt-3 space-y-1.5 text-sm">
          {evidenceItems.map((e, i) => <li key={i} className={`flex flex-wrap items-baseline gap-x-2 rounded-lg border px-3 py-2 ${e.ok ? "border-emerald-100 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}`}><span className={e.ok ? "text-emerald-700" : "text-amber-700"}>{e.ok ? "✓" : "○"}</span><span className="text-slate-800">{e.label}</span>{!e.ok && <Link href={e.href} className="ml-auto text-xs font-medium text-rose-700 hover:underline">fix: {e.fix} →</Link>}</li>)}
        </ul>
      </section>

      {/* 5 · Exceptions */}
      <section id="exceptions" className="scroll-mt-16">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">5 · Exceptions <span className="text-sm font-normal text-slate-500">— what the records raise for {inst.name} · <Link href="/setup/exceptions" className="text-rose-600 hover:underline">every college →</Link></span></h2>
        <ExceptionQueue items={exceptions} />
      </section>

      {/* Operational records — drill-downs, not destinations */}
      <section id="operational" className="scroll-mt-16 rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
        <h2 className="text-sm font-semibold text-slate-700">Operational records &amp; diagnostics</h2>
        <p className="text-xs text-slate-500">{OPERATIONAL ? "The operational module is on: these screens write the operating plan." : "Read-only in the strategic product: imported actuals shown as evidence, and diagnostic drill-downs. Person-level detail is kept to coded fields."}</p>
        <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {([["Students (roster)", "/students"], ["Learner analytics", "/students/analytics"], ["People", "/people"], ["Master calendar", "/calendar"], ["Semester view", `/semester?inst=${inst.id}`], ["Clinical scheduler", `/scheduler?inst=${inst.id}`], ["Partner organizations", "/employers"], ["Explore (diagnostic pivot)", "/insights/explore"]] as [string, string][]).map(([l, h]) => <li key={h}><Link href={h} className="rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200 hover:text-rose-700 hover:ring-rose-300">{l}</Link></li>)}
        </ul>
      </section>
    </div>
  );
}
