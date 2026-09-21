import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getOrganization, getWorkloadPolicies, getInstitutionsLite, getStaffRoles, getAssetsLite, getRoomsWorkspace, getCalendarProvenance, getRegistryCandidates } from "@/lib/queries";
import { updateInstitution, updateInstitutionGeography, createEmployer, addSiteAsPartner } from "@/lib/actions";
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
import { HOLIDAY_RULES, BREAK_RULE_TEXT } from "@/lib/holidayrule";
import { DRIVE_BAND_TONE } from "@/lib/geo";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

// SETUP for one institution (Phase 13) — five jobs, in order: the CONNECTIONS the records come in
// through, the MAPPINGS that place those records on the model (campus, rooms, sites and assets,
// people and policies, programs), the planning ASSUMPTIONS, the EVIDENCE REVIEW of what is verified
// and what is only estimated, and the EXCEPTIONS the records raise. The operational records
// themselves (students, people, the calendar, the scheduler) are linked as drill-downs at the end.

const ROLE_LABEL: Record<string, string> = { instructor: "Faculty", preceptor: "Preceptors", support: "Support staff", supervisor: "Supervisors", coordinator: "Coordinators" };
const AGREE_LABEL: Record<string, string> = { secured: "secured", asked: "asked", prospect: "prospect", none: "no agreement" };

export default async function OrganizationPage({ params }: { params: { id: string } }) {
  const [data, policies, institutions, rolesRaw, assetsLite, ws, exceptionsAll, provenance, registryCandidates] = await Promise.all([getOrganization(params.id), getWorkloadPolicies(), getInstitutionsLite(), getStaffRoles(), getAssetsLite(), getRoomsWorkspace(params.id), getExceptionQueue(), getCalendarProvenance(params.id), getRegistryCandidates(params.id)]);
  if (!data) notFound();
  const { inst, assets, employersLite } = data;
  const familyIds = inst.programFamilies.map((f) => f.id);
  const programIds = inst.programFamilies.flatMap((f) => f.programs.map((p) => p.id));
  const [assumptionRows, reqSets, sitesEstimate, sitesSecured, assetsEstimate, assetsTotal, students, cohorts] = await Promise.all([
    prisma.assumption.findMany({ where: { scope: { in: [scopeOf.global, scopeOf.institution(inst.id), ...familyIds.map((id) => scopeOf.family(id)), ...programIds.map((id) => scopeOf.program(id))] } }, select: { scope: true, status: true, reviewBy: true } }),
    prisma.clinicalRequirementSet.findMany({ where: { familyId: { in: familyIds } }, select: { id: true, familyId: true, authority: true, verified: true, family: { select: { name: true, programs: { select: { id: true }, take: 1 } } } } }),
    prisma.familySite.count({ where: { familyId: { in: familyIds }, agreementStatus: "secured", staffCountSource: { not: "VERIFIED" } } }),
    prisma.familySite.count({ where: { familyId: { in: familyIds }, agreementStatus: "secured" } }),
    prisma.clinicalAsset.count({ where: { employer: { institutionId: inst.id }, status: { not: "archived" }, dataSource: { not: "VERIFIED" } } }),
    prisma.clinicalAsset.count({ where: { employer: { institutionId: inst.id }, status: { not: "archived" } } }),
    prisma.student.count({ where: { programId: { in: programIds } } }),
    prisma.cohort.count({ where: { programId: { in: programIds } } }),
  ]);
  const roles = rolesRaw.map((r) => ({ id: r.id, institutionId: r.institutionId, institution: r.institution.name, key: r.key, label: r.label, family: r.family, notes: r.notes }));
  const codedStarts = inst.academicEvents.filter((e) => e.kind === "term_start");
  const holidays = inst.academicEvents.filter((e) => e.kind === "holiday").length;
  const agree = new Map<string, number>(); for (const e of inst.employers) agree.set(e.agreementStatus, (agree.get(e.agreementStatus) ?? 0) + 1);
  const peopleByRole = new Map<string, number>(); for (const p of inst.people) if (p.active) peopleByRole.set(p.role, (peopleByRole.get(p.role) ?? 0) + 1);
  const ownPolicies = policies.filter((p) => p.institutionId === inst.id);
  const mainCampus = inst.campuses[0] ?? null;
  const located = inst.employers.filter((e) => e.driveMinutes != null).length;
  const seatsAShift = inst.employers.reduce((n, e) => n + e.assets.reduce((m, a) => m + a.learnersPerShift, 0), 0);
  const preceptorsOnRecord = inst.employers.reduce((n, e) => n + e._count.people, 0);
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
    { label: "Mappings", ok: !!(inst.kind && inst.city) && ws.rooms.length > 0 && inst.people.length > 0 && programs > 0, href: "#mappings" },
    { label: "Clinical sites", ok: (agree.get("secured") ?? 0) > 0 && assetsTotal > 0, href: "#sites" },
    { label: "Assumptions", ok: ownAssumptions.length > 0, href: "#assumptions" },
    { label: "Evidence review", ok: evidenceItems.every((e) => e.ok), href: "#evidence" },
    { label: "Exceptions", ok: blockers === 0, href: "#exceptions" },
  ];
  const inp = "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm";
  const lbl = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500";

  return (
    <div className="space-y-6">
      <div>
        <PageHeader crumb={{ href: "/setup", label: "Setup" }} title={<>{inst.name} — setup</>} meta={[inst.kind, [inst.city, inst.state].filter(Boolean).join(", "), inst.serviceArea].filter(Boolean).join(" · ")} actions={<><Link href={`/orgs/${inst.id}/assumptions`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Planning assumptions →</Link><Link href="/setup/exceptions" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">All exceptions →</Link></>} />
        <div className="-mt-2 flex flex-wrap gap-1.5">
          {steps.map((s) => <a key={s.label} href={s.href} className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-50 text-amber-800 ring-1 ring-amber-200"}`}>{s.ok ? "✓" : "○"} {s.label}</a>)}
        </div>
      </div>

      {/* 1 · Connections & imports */}
      <section id="connections" className="scroll-mt-16 space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">1 · Connections &amp; imports</h2>
          <p className="text-xs text-slate-500">Where the records come from.</p>
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
          <p className="text-xs text-slate-500">The campus, rooms, clinical sites, people and programs.</p>
        </div>
        <div id="basics">
          <Collapse title="Basics & geography" sub="Name, city, holiday rule, main campus and drive-time bands" summary={<>{inst.shortName ?? inst.name}{inst.kind ? ` · ${inst.kind}` : ""} · {mainCampus?.lat != null ? "campus located" : "campus not located"} · drive-time bands at {inst.ringCoreMinutes}, {inst.ringOneMinutes} and {inst.ringTwoMinutes} min</>}>
            <form action={updateInstitution.bind(null, inst.id)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block"><span className={lbl}>Name</span><input name="name" defaultValue={inst.name} required className={inp} /></label>
              <label className="block"><span className={lbl}>Short name</span><input name="shortName" defaultValue={inst.shortName ?? ""} className={inp} /></label>
              <label className="block"><span className={lbl}>Kind</span><select name="kind" defaultValue={inst.kind ?? ""} className={inp}><option value="">—</option><option>Community college</option><option>University</option><option>Health system</option><option>Career center</option><option>Other</option></select></label>
              <label className="block"><span className={lbl}>City</span><input name="city" defaultValue={inst.city ?? ""} className={inp} /></label>
              <label className="block"><span className={lbl}>State</span><input name="state" defaultValue={inst.state ?? "NC"} className={inp} /></label>
              <label className="block"><span className={lbl}>Service area</span><input name="serviceArea" defaultValue={inst.serviceArea ?? ""} placeholder="counties / region the goals cover" className={inp} /></label>
              <label className="block lg:col-span-2"><span className={lbl}>Holiday rule — class, lab and clinical</span><select name="holidayRule" defaultValue={inst.holidayRule} className={inp}>{HOLIDAY_RULES.map((r) => <option key={r.value} value={r.value} title={r.hint}>{r.label}</option>)}</select><span className="mt-1 block text-[11px] text-slate-500">{HOLIDAY_RULES.find((r) => r.value === inst.holidayRule)?.hint}. {BREAK_RULE_TEXT}</span></label>
              <div className="flex items-end"><button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Save basics</button></div>
            </form>
            <form action={updateInstitutionGeography.bind(null, inst.id)} className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Main campus &amp; drive-time bands <span className="font-normal normal-case text-slate-400">— every site is banded by its drive time from this address</span></div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                <label className="block lg:col-span-2"><span className={lbl}>Campus street address</span><input name="campusAddress" defaultValue={mainCampus?.address ?? ""} placeholder="3395 Airport Rd" className={inp} /></label>
                <label className="block"><span className={lbl}>City</span><input name="campusCity" defaultValue={mainCampus?.city ?? inst.city ?? ""} className={inp} /></label>
                <label className="block"><span className={lbl}>ZIP</span><input name="campusZip" defaultValue={mainCampus?.zip ?? ""} className={inp} /></label>
                <div className="lg:col-span-2 text-xs text-slate-500">
                  {mainCampus ? <>{mainCampus.name}{mainCampus.lat != null ? <> · located {mainCampus.geoSource === "census" ? "street-level (Census)" : mainCampus.geoSource === "gazetteer" ? "at the town centre (built-in gazetteer)" : "by hand"} · <span className="font-mono">{dec(mainCampus.lat, 4)}, {mainCampus.lng != null ? dec(mainCampus.lng, 4) : ""}</span></> : <span className="text-amber-700"> · not located yet</span>}</> : <span className="text-amber-700">No campus yet — saving creates one.</span>}
                </div>
                <label className="block"><span className={lbl}>Nearest band, up to (min)</span><input name="ringCoreMinutes" type="number" min={1} defaultValue={inst.ringCoreMinutes} className={inp} /></label>
                <label className="block"><span className={lbl}>Second band, up to (min)</span><input name="ringOneMinutes" type="number" min={1} defaultValue={inst.ringOneMinutes} className={inp} /></label>
                <label className="block"><span className={lbl}>Third band, up to (min)</span><input name="ringTwoMinutes" type="number" min={1} defaultValue={inst.ringTwoMinutes} className={inp} /></label>
                <div className="text-xs text-slate-500 lg:col-span-2">Anything farther is the last band; drive time is an estimate for banding, not a route.</div>
                <div className="flex items-end"><button className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700">Save &amp; recompute drive times</button></div>
              </div>
            </form>
          </Collapse>
        </div>
        <div id="rooms" className="scroll-mt-16">
          <Collapse title="Campuses, buildings, rooms & equipment" sub="Rooms with their open hours, and the equipment in them" summary={<>{ws.campuses.length} campus{ws.campuses.length === 1 ? "" : "es"} · {ws.buildings.length} buildings · {ws.rooms.length} rooms · {ws.equipment.reduce((n, e) => n + e.quantity, 0)} pieces of equipment{ws.rooms.some((r) => r.hours.length === 0) ? ` · ⚠ ${ws.rooms.filter((r) => r.hours.length === 0).length} rooms without hours` : ""}</>}>
            <RoomsWorkspace rooms={ws.rooms} campuses={ws.campuses} buildings={ws.buildings} equipment={ws.equipment} institutions={institutions} defaultInstitutionId={inst.id} />
          </Collapse>
        </div>
        <div id="people" className="scroll-mt-16">
          <Collapse title="People, staff roles & workload policies" sub="Faculty, preceptors and support staff, their roles, and the policies that turn contact hours into load" summary={<>{inst.people.filter((p) => p.active).length} active people · {[...peopleByRole.entries()].map(([k, n]) => `${n} ${(ROLE_LABEL[k] ?? k).toLowerCase()}`).join(" · ")} · {ownPolicies.length} policies</>}>
            <div className="mb-3 flex flex-wrap gap-3 text-xs"><Link href="/people" className="text-rose-600 hover:underline">the people roster (imported record) →</Link></div>
            <div className="mb-3"><div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Staff roles</div><StaffRoles roles={roles} institutions={institutions} defaultInstitutionId={inst.id} /></div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Workload policies</div>
            <WorkloadPolicies policies={policies} institutions={institutions} employers={employersLite} assets={assetsLite} roles={roles} defaultInstitutionId={inst.id} />
          </Collapse>
        </div>
        <div id="programs" className="scroll-mt-16">
          <Collapse title="Programs built on this setup" sub="Each job and the program that delivers it" summary={<>{inst.programFamilies.length} jobs · {programs} programs</>}>
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
                        <span className="ml-auto flex gap-2 text-xs"><Link href={`/programs/${p.id}/structure`} className="text-rose-600 hover:underline">design</Link><Link href={`/programs/${p.id}/clinical`} className="text-rose-600 hover:underline">clinical sites</Link><Link href={`/programs/${p.id}/goal`} className="text-rose-600 hover:underline">goal</Link></span>
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

      {/* 3 · Clinical sites & partners — the network the programs place students in: seen, created and managed here */}
      <section id="sites" className="scroll-mt-16 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">3 · Clinical sites &amp; partners</h2>
            <p className="text-xs text-slate-500">Every partner site, how far it is, what is agreed, and what a student can be placed on there. Open a site for its assets, shifts, closures and people.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Link href="/clinical" className="rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50">Sites &amp; requirements by program →</Link>
            <Link href={`/scheduler?inst=${inst.id}`} className="rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50">Clinical scheduler →</Link>
            <Link href={`/insights/map?inst=${inst.id}`} className="rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50">Map →</Link>
            <Link href="/sites" className="rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50" title="every site the platform knows, whichever college approaches it">Site registry →</Link>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {([["Sites", fmt.num(inst.employers.length), `${located} located`], ["Secured", fmt.num(agree.get("secured") ?? 0), `${agree.get("asked") ?? 0} asked · ${agree.get("prospect") ?? 0} prospects`], ["Assets", fmt.num(assetsTotal), `${assetsEstimate} not yet confirmed`], ["Seats a shift", fmt.num(seatsAShift), "students every asset takes at once"], ["Preceptors", fmt.num(preceptorsOnRecord), "on the sites' rosters"], ["Programs served", fmt.num(inst.programFamilies.filter((f) => inst.employers.some((e) => e.familySites.some((x) => x.family.id === f.id))).length), `of ${inst.programFamilies.length}`]] as [string, string, string][]).map(([l, v, sub]) => (
            <div key={l} className="rounded-xl border border-slate-200 bg-white px-3 py-2"><div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{l}</div><div className="text-xl font-semibold tabular-nums text-slate-900">{v}</div><div className="truncate text-[10px] text-slate-400">{sub}</div></div>
          ))}
        </div>
        <div className="max-h-[36rem] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 text-left">Site</th><th className="px-2 py-2 text-left">Type</th><th className="px-2 py-2 text-left">Drive from campus</th><th className="px-2 py-2 text-left">Agreement</th><th className="px-2 py-2 text-left">Programs served</th><th className="px-2 py-2 text-right">Assets</th><th className="px-2 py-2 text-right">Seats a shift</th><th className="px-2 py-2 text-right">Preceptors</th><th className="px-2 py-2" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {[...inst.employers].sort((a, b) => (a.driveMinutes ?? 9e9) - (b.driveMinutes ?? 9e9) || a.name.localeCompare(b.name)).map((e) => (
                <tr key={e.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-1.5"><Link href={`/employers/${e.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{e.name}</Link><span className="block text-[10px] text-slate-400">{[e.organization, e.city].filter(Boolean).join(" · ")}</span></td>
                  <td className="px-2 py-1.5 text-slate-600">{e.facilityType ?? "—"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{e.driveMinutes != null ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${DRIVE_BAND_TONE[e.ring ?? ""] ?? "bg-slate-100 text-slate-600"}`}>≈ {fmt.minutes(e.driveMinutes)}{e.ringSource === "manual" ? " ✎" : ""}</span> : <span className="text-amber-700">not located</span>}</td>
                  <td className="px-2 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${e.agreementStatus === "secured" ? "bg-emerald-100 text-emerald-800" : e.agreementStatus === "asked" ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-500"}`}>{AGREE_LABEL[e.agreementStatus] ?? e.agreementStatus}</span></td>
                  <td className="px-2 py-1.5 text-slate-600">{e.familySites.length ? e.familySites.map((x) => <Link key={x.family.id} href={x.family.programs[0] ? `/programs/${x.family.programs[0].id}/clinical/sites/${e.id}` : "/clinical"} className={`mr-1 inline-block rounded px-1 text-[10px] hover:underline ${x.agreementStatus === "secured" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`} title={`${x.family.name}: ${x.agreementStatus}`}>{x.family.name}</Link>) : <span className="text-slate-300">none yet</span>}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt.num(e.assets.length)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt.num(e.assets.reduce((n, a) => n + a.learnersPerShift, 0))}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt.num(e._count.people)}</td>
                  <td className="px-2 py-1.5 text-right"><Link href={`/employers/${e.id}`} className="text-rose-700 hover:underline">assets &amp; shifts →</Link></td>
                </tr>
              ))}
              {inst.employers.length === 0 && <tr><td colSpan={9} className="px-3 py-4 text-center text-slate-400">No clinical sites yet — add the first one below.</td></tr>}
            </tbody>
          </table>
        </div>
        <details className="rounded-xl border border-dashed border-slate-300 bg-white">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-700">+ Add a clinical site or partner</summary>
          {registryCandidates.length > 0 && (
            <form action={addSiteAsPartner} className="flex flex-wrap items-end gap-2 border-t border-slate-100 bg-indigo-50/40 p-4 text-xs">
              <input type="hidden" name="institutionId" value={inst.id} />
              <label className="block min-w-[18rem] flex-1"><span className={lbl}>A site another college already knows (the shared registry)</span>
                <select name="siteId" required className={inp}><option value="">— pick a site —</option>{registryCandidates.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ""}{c.facilityType ? ` · ${c.facilityType}` : ""}{c.partners.length ? ` — partner of ${c.partners.map((p) => p.institution.name.replace(/ Community College$/, "")).join(", ")}` : ""}</option>)}</select></label>
              <label className="block"><span className={lbl}>Your agreement</span><select name="agreementStatus" className={inp}>{["prospect", "asked", "secured", "none"].map((a) => <option key={a} value={a}>{AGREE_LABEL[a] ?? a}</option>)}</select></label>
              <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Add as {inst.name.replace(/ Community College$/, "")}&apos;s partner</button>
              <p className="w-full text-[11px] text-slate-500">The site&apos;s identity (address, type, beds) is shared with every college; your agreement, contacts, drive time from your campus and the assets you are granted are yours alone.</p>
            </form>
          )}
          <form action={createEmployer} className="grid gap-2 border-t border-slate-100 p-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <p className="text-[11px] font-medium text-slate-500 sm:col-span-2 lg:col-span-4">Or a site nobody has recorded yet:</p>
            <input type="hidden" name="institutionId" value={inst.id} />
            <label className="block lg:col-span-2"><span className={lbl}>Site name</span><input name="name" required placeholder="FirstHealth Moore Regional Hospital" className={inp} /></label>
            <label className="block"><span className={lbl}>Organization / system</span><input name="organization" placeholder="optional" className={inp} /></label>
            <label className="block"><span className={lbl}>Facility type</span><select name="facilityType" className={inp}><option value="">—</option>{["Acute care hospital", "Specialty hospital", "Ambulatory surgery center", "Nursing home", "Combination home (NH + adult care)", "Adult care home", "Physician office / clinic", "Imaging center", "Behavioral health facility", "Home health / hospice", "Public health / community", "Other"].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
            <label className="block lg:col-span-2"><span className={lbl}>Street address</span><input name="address" className={inp} /></label>
            <label className="block"><span className={lbl}>City</span><input name="city" className={inp} /></label>
            <label className="block"><span className={lbl}>ZIP</span><input name="zip" className={inp} /></label>
            <input type="hidden" name="state" value={inst.state ?? "NC"} />
            <label className="block"><span className={lbl}>Umbrella agreement</span><select name="agreementStatus" className={inp}>{["none", "prospect", "asked", "secured"].map((a) => <option key={a} value={a}>{AGREE_LABEL[a] ?? a}</option>)}</select></label>
            <label className="block"><span className={lbl}>Contact name</span><input name="contactName" className={inp} /></label>
            <label className="block"><span className={lbl}>Contact email</span><input name="contactEmail" type="email" className={inp} /></label>
            <div className="flex items-end"><button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Add site</button></div>
            <p className="text-[11px] text-slate-400 sm:col-span-2 lg:col-span-4">The site is located from its address and its drive time from the main campus computed. Its assets, shifts and people are entered on the site&apos;s own page; what it means to each program (agreement, experiences) on that program&apos;s clinical pages.</p>
          </form>
        </details>
      </section>

      {/* 4 · Assumptions */}
      <section id="assumptions" className="scroll-mt-16 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">4 · Planning assumptions</h2>
          <Link href={`/orgs/${inst.id}/assumptions`} className="text-sm text-rose-600 hover:underline">open the registry →</Link>
        </div>
        <p className="text-xs text-slate-500">The rates, lags, costs and workload figures the answers rest on. The most specific scope wins: program over job family over college over workspace.</p>
        <p className="mt-2 text-sm text-slate-800">{ownAssumptions.length === 0 ? <span className="text-amber-700">No figure set for this college yet; every answer rests on workspace defaults.</span> :<>{fmt.num(ownAssumptions.length)} figures set at the college, family or program scope · {fmt.num(verifiedAssumptions)} verified{staleAssumptions ? <span className="text-rose-700"> · {fmt.num(staleAssumptions)} past their review date</span> : null}</>}</p>
      </section>

      {/* 5 · Evidence review */}
      <section id="evidence" className="scroll-mt-16 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">5 · Evidence review</h2>
        <p className="text-xs text-slate-500">What is verified and what is only estimated.</p>
        <ul className="mt-3 space-y-1.5 text-sm">
          {evidenceItems.map((e, i) => <li key={i} className={`flex flex-wrap items-baseline gap-x-2 rounded-lg border px-3 py-2 ${e.ok ? "border-emerald-100 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}`}><span className={e.ok ? "text-emerald-700" : "text-amber-700"}>{e.ok ? "✓" : "○"}</span><span className="text-slate-800">{e.label}</span>{!e.ok && <Link href={e.href} className="ml-auto text-xs font-medium text-rose-700 hover:underline">fix: {e.fix} →</Link>}</li>)}
        </ul>
      </section>

      {/* 6 · Exceptions */}
      <section id="exceptions" className="scroll-mt-16">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">6 · Exceptions <span className="text-sm font-normal text-slate-500">— what the records raise for {inst.name} · <Link href="/setup/exceptions" className="text-rose-600 hover:underline">every college →</Link></span></h2>
        <ExceptionQueue items={exceptions} />
      </section>

      {/* Operational records — drill-downs, not destinations */}
      <section id="operational" className="scroll-mt-16 rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
        <h2 className="text-sm font-semibold text-slate-700">Operational records &amp; diagnostics</h2>
        <p className="text-xs text-slate-500">{OPERATIONAL ? "The operational module is on: these screens write the operating plan." : "Read-only records and diagnostic drill-downs."}</p>
        <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {([["Students (roster)", "/students"], ["Learner analytics", "/students/analytics"], ["People", "/people"], ["Master calendar", "/calendar"], ["Semester view", `/semester?inst=${inst.id}`], ["Clinical scheduler", `/scheduler?inst=${inst.id}`], ["Partner organizations", "/employers"], ["Explore (diagnostic pivot)", "/insights/explore"]] as [string, string][]).map(([l, h]) => <li key={h}><Link href={h} className="rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200 hover:text-rose-700 hover:ring-rose-300">{l}</Link></li>)}
        </ul>
      </section>
    </div>
  );
}
