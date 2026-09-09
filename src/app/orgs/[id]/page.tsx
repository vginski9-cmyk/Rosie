import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrganization, getWorkloadPolicies, getInstitutionsLite } from "@/lib/queries";
import { updateInstitution } from "@/lib/actions";
import { AcademicCalendar } from "@/components/AcademicCalendar";
import { WorkloadPolicies } from "@/components/WorkloadPolicies";
import { Collapse } from "@/components/Collapse";

export const dynamic = "force-dynamic";

// One institution, set up and mapped in one place: basics → academic calendar
// → rooms & labs → clinical sites & physical assets → people & workload
// policies → the jobs and programs built on all of it.

const ROLE_LABEL: Record<string, string> = { instructor: "Faculty", preceptor: "Preceptors", support: "Support staff", supervisor: "Supervisors", coordinator: "Coordinators" };
const AGREE_LABEL: Record<string, string> = { secured: "secured", asked: "asked", prospect: "prospect", none: "no agreement" };

export default async function OrganizationPage({ params }: { params: { id: string } }) {
  const [data, policies, institutions] = await Promise.all([getOrganization(params.id), getWorkloadPolicies(), getInstitutionsLite()]);
  if (!data) notFound();
  const { inst, assets, employersLite } = data;
  const codedStarts = inst.academicEvents.filter((e) => e.kind === "term_start");
  const roomsByKind = new Map<string, number>(); for (const f of inst.facilities) roomsByKind.set(f.kind, (roomsByKind.get(f.kind) ?? 0) + 1);
  const agree = new Map<string, number>(); for (const e of inst.employers) agree.set(e.agreementStatus, (agree.get(e.agreementStatus) ?? 0) + 1);
  const peopleByRole = new Map<string, number>(); for (const p of inst.people) if (p.active) peopleByRole.set(p.role, (peopleByRole.get(p.role) ?? 0) + 1);
  const ownPolicies = policies.filter((p) => p.institutionId === inst.id);
  const programs = inst.programFamilies.reduce((n, f) => n + f.programs.length, 0);
  const steps = [
    { label: "Basics", ok: !!(inst.kind && inst.city), href: "#basics" },
    { label: "Academic calendar", ok: codedStarts.length > 0, href: "#calendar" },
    { label: "Rooms & labs", ok: inst.facilities.length > 0, href: "#rooms" },
    { label: "Clinical sites", ok: inst.employers.length > 0, href: "#sites" },
    { label: "Physical assets", ok: assets.length > 0, href: "#sites" },
    { label: "People", ok: inst.people.length > 0, href: "#people" },
    { label: "Workload policies", ok: ownPolicies.length > 0, href: "#people" },
    { label: "Programs", ok: programs > 0, href: "#programs" },
  ];
  const inp = "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm";
  const lbl = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/orgs" className="text-sm text-slate-500 hover:text-slate-700">← Organizations</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{inst.name}</h1>
            <p className="text-sm text-slate-500">{[inst.kind, [inst.city, inst.state].filter(Boolean).join(", "), inst.serviceArea].filter(Boolean).join(" · ")}</p>
          </div>
          <Link href={`/#inst-${inst.id}`} className="text-sm text-rose-600 hover:underline">North Star goals →</Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {steps.map((s) => <a key={s.label} href={s.href} className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-50 text-amber-800 ring-1 ring-amber-200"}`}>{s.ok ? "✓" : "○"} {s.label}</a>)}
        </div>
      </div>

      {/* 1 · Basics */}
      <section id="basics" className="scroll-mt-16">
        <Collapse title="1 · Basics" sub="Name, type, home city and the service area the goals are measured against" summary={<>{inst.shortName ?? inst.name}{inst.kind ? ` · ${inst.kind}` : ""}</>}>
          <form action={updateInstitution.bind(null, inst.id)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block"><span className={lbl}>Name</span><input name="name" defaultValue={inst.name} required className={inp} /></label>
            <label className="block"><span className={lbl}>Short name</span><input name="shortName" defaultValue={inst.shortName ?? ""} className={inp} /></label>
            <label className="block"><span className={lbl}>Kind</span><select name="kind" defaultValue={inst.kind ?? ""} className={inp}><option value="">—</option><option>Community college</option><option>University</option><option>Health system</option><option>Career center</option><option>Other</option></select></label>
            <label className="block"><span className={lbl}>City</span><input name="city" defaultValue={inst.city ?? ""} className={inp} /></label>
            <label className="block"><span className={lbl}>State</span><input name="state" defaultValue={inst.state ?? "NC"} className={inp} /></label>
            <label className="block"><span className={lbl}>Service area</span><input name="serviceArea" defaultValue={inst.serviceArea ?? ""} placeholder="counties / region the goals cover" className={inp} /></label>
            <div className="flex items-end"><button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Save basics</button></div>
          </form>
        </Collapse>
      </section>

      {/* 2 · Academic calendar */}
      <section id="calendar" className="scroll-mt-16">
        <AcademicCalendar
          title="2 · Academic calendar" institutionId={inst.id} institutionName={inst.name} familyId=""
          anchors={{ springStart: inst.springStart, summerStart: inst.summerStart, fallStart: inst.fallStart }}
          coded={inst.academicEvents.map((e) => ({ id: e.id, iso: e.date.toISOString().slice(0, 10), endIso: e.endDate?.toISOString().slice(0, 10) ?? null, label: e.label, kind: e.kind, season: e.season }))}
        />
      </section>

      {/* 3 · Rooms & labs */}
      <section id="rooms" className="scroll-mt-16">
        <Collapse title="3 · Rooms, labs & simulation spaces" sub="The campus supply of space that class and lab sections are booked into" summary={<>{inst.facilities.length} spaces · {[...roomsByKind.entries()].map(([k, n]) => `${n} ${k.toLowerCase()}`).join(" · ")}</>}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>{inst.facilities.reduce((n, f) => n + (f.capacity ?? 0), 0)} seats / stations in all.</span>
            <Link href="/facilities" className="text-rose-600 hover:underline">add or edit rooms in Facilities →</Link>
          </div>
          <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">Space</th><th className="px-2 py-1.5 text-left">Kind</th><th className="px-2 py-1.5 text-left">Building</th><th className="px-2 py-1.5 text-right">Capacity</th><th className="px-2 py-1.5 text-left">Hours</th><th className="px-2 py-1.5 text-left">Equipment</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {inst.facilities.map((f) => <tr key={f.id}><td className="px-3 py-1 font-medium text-slate-800">{f.name}</td><td className="px-2 py-1 text-slate-600">{f.kind}</td><td className="px-2 py-1 text-slate-600">{f.building ?? "—"}</td><td className="px-2 py-1 text-right tabular-nums">{f.capacity ?? "—"}</td><td className="px-2 py-1 text-slate-500">{f.hours ?? "—"}</td><td className="max-w-[24rem] truncate px-2 py-1 text-slate-500">{f.equipment ?? "—"}</td></tr>)}
                {inst.facilities.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">No rooms mapped yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Collapse>
      </section>

      {/* 4 · Clinical sites & assets */}
      <section id="sites" className="scroll-mt-16">
        <Collapse title="4 · Clinical sites & their physical assets" sub="Partner organizations, agreements, and every room, unit and machine a learner can be placed on, by setting" summary={<>{inst.employers.length} sites · {assets.reduce((n, a) => n + a.count, 0)} assets · {[...agree.entries()].map(([k, n]) => `${n} ${AGREE_LABEL[k] ?? k}`).join(" · ")}</>}>
          <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Assets by setting</div>
              <table className="mt-1 w-full text-xs"><tbody className="divide-y divide-slate-100">
                {assets.map((a) => <tr key={a.settingCode}><td className="py-1 font-medium text-slate-700">{a.settingCode}</td><td className="py-1 text-right tabular-nums">{a.count} assets</td><td className="py-1 text-right tabular-nums text-slate-500">{a.learners} learners / shift</td></tr>)}
                {assets.length === 0 && <tr><td className="py-2 text-slate-400">No assets mapped yet — add them on each site&apos;s page.</td></tr>}
              </tbody></table>
              <div className="mt-2 flex flex-wrap gap-3 text-xs"><Link href="/employers" className="text-rose-600 hover:underline">all partner organizations →</Link><Link href="/clinical" className="text-rose-600 hover:underline">sites & supply by program →</Link><Link href="/scheduler" className="text-rose-600 hover:underline">clinical scheduler →</Link></div>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">Site</th><th className="px-2 py-1.5 text-left">Type</th><th className="px-2 py-1.5 text-left">Ring</th><th className="px-2 py-1.5 text-left">Agreement</th><th className="px-2 py-1.5 text-right">Assets</th><th className="px-2 py-1.5 text-right">Preceptors</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {inst.employers.map((e) => <tr key={e.id}><td className="px-3 py-1"><Link href={`/employers/${e.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{e.name}</Link></td><td className="px-2 py-1 text-slate-600">{e.facilityType ?? "—"}</td><td className="px-2 py-1 text-slate-600">{e.ring ?? "—"}</td><td className="px-2 py-1"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${e.agreementStatus === "secured" ? "bg-emerald-100 text-emerald-800" : e.agreementStatus === "asked" ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-500"}`}>{AGREE_LABEL[e.agreementStatus] ?? e.agreementStatus}</span></td><td className="px-2 py-1 text-right tabular-nums">{e._count.assets}</td><td className="px-2 py-1 text-right tabular-nums">{e._count.people}</td></tr>)}
                  {inst.employers.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">No clinical sites yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </Collapse>
      </section>

      {/* 5 · People & workload policies */}
      <section id="people" className="scroll-mt-16">
        <Collapse title="5 · People & workload policies" sub="Faculty, adjuncts, support staff, coordinators and the preceptors at partner sites — and the policies that turn each person's assigned contact hours into load" summary={<>{inst.people.filter((p) => p.active).length} active people · {[...peopleByRole.entries()].map(([k, n]) => `${n} ${(ROLE_LABEL[k] ?? k).toLowerCase()}`).join(" · ")} · {ownPolicies.length} policies</>}>
          <div className="mb-3 flex flex-wrap gap-3 text-xs"><Link href="/people" className="text-rose-600 hover:underline">add or edit people →</Link></div>
          <WorkloadPolicies policies={policies} institutions={institutions} employers={employersLite} defaultInstitutionId={inst.id} />
        </Collapse>
      </section>

      {/* 6 · Programs */}
      <section id="programs" className="scroll-mt-16">
        <Collapse title="6 · Jobs & programs built on this set-up" sub="Each North Star job and the program templates that deliver toward it; configure courses, sessions and offerings from here" summary={<>{inst.programFamilies.length} jobs · {programs} programs</>} defaultOpen>
          <div className="space-y-3">
            {inst.programFamilies.map((f) => (
              <div key={f.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/families/${f.id}`} className="font-semibold text-slate-800 hover:text-rose-700 hover:underline">{f.occupation?.title ?? f.name} ↦</Link>
                  <span className="text-xs text-slate-500">{f.name}{f.occupation ? ` · SOC ${f.occupation.socCode}` : ""}</span>
                </div>
                <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-100">
                  {f.programs.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-sm">
                      <Link href={`/programs/${p.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{p.name}</Link>
                      <span className="text-xs text-slate-500">{p.credential ?? "—"} · {p.programType} · {p._count.terms} terms{p.defaultCohortSeats ? ` · up to ${p.defaultCohortSeats} seats` : ""} · {p._count.cohorts} offering{p._count.cohorts === 1 ? "" : "s"}</span>
                      <span className="ml-auto flex gap-2 text-xs"><Link href={`/programs/${p.id}/structure`} className="text-rose-600 hover:underline">design &amp; sequence</Link></span>
                    </div>
                  ))}
                  {f.programs.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No program templates yet.</div>}
                </div>
              </div>
            ))}
            {inst.programFamilies.length === 0 && <p className="text-sm text-slate-400">No jobs yet — add a North Star goal for this institution on the home page.</p>}
          </div>
        </Collapse>
      </section>
    </div>
  );
}
