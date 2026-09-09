import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamilySiteSetup } from "@/lib/queries";
import { upsertFamilySite, removeFamilySite, updateSiteAvailability, relocateSite } from "@/lib/actions";
import { AssetRoster } from "@/components/AssetRoster";
import { AccreditorCapacity } from "@/components/AccreditorCapacity";
import { SiteProvisionChecklist } from "@/components/SiteProvisionChecklist";
import { SETTING_PRESETS } from "@/lib/settingPresets";
import { dec } from "@/lib/format";

// ONE SITE, SET UP FOR ONE PROGRAM — in the order a coordinator fills it in: where it is,
// the agreement, the accreditor's recognition, the availability agreed, its assets and shift
// structures, the qualified staff, and item by item what it provides. Server component.

const AGREEMENT: Record<string, string> = { none: "bg-slate-100 text-slate-500", prospect: "bg-sky-100 text-sky-700", asked: "bg-amber-100 text-amber-700", secured: "bg-emerald-100 text-emerald-700", declined: "bg-rose-100 text-rose-700" };
const RING: Record<string, string> = { Core: "bg-emerald-100 text-emerald-800", "Ring 1": "bg-sky-100 text-sky-800", "Ring 2": "bg-amber-100 text-amber-800", "Ring 3": "bg-rose-100 text-rose-800" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], BLOCKS = ["Day", "Evening", "Night"];
const inp = "rounded border border-slate-300 px-2 py-1 text-xs";
const lbl = "block text-[10px] font-semibold uppercase tracking-wide text-slate-500";
const csv = (v: string | null | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

function Section({ id, n, title, sub, children, right }: { id: string; n: number; title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">{n} · {title}{sub && <span className="font-normal text-slate-400"> — {sub}</span>}</h2>
        {right}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export async function FamilySiteSetup({ familyId, employerId, base }: { familyId: string; employerId: string; base: string }) {
  const d = await getFamilySiteSetup(familyId, employerId);
  if (!d) notFound();
  const { family: fam, site, familySite: fs } = d;
  const familyAssets = d.assets.filter((a) => a.inFamily);
  const seatsBySetting: Record<string, number> = {}; for (const a of familyAssets) if (a.status !== "archived") seatsBySetting[a.settingCode] = (seatsBySetting[a.settingCode] ?? 0) + a.learnersPerShift;
  const otherAssets = d.assets.filter((a) => !a.inFamily);
  const settingOptions = d.settings.map((code) => ({ code, name: SETTING_PRESETS.find((p) => p[0] === code)?.[1] ?? d.areas.find((a) => csv(a.settingCodes).includes(code))?.name ?? code, assetType: SETTING_PRESETS.find((p) => p[0] === code)?.[2] }));
  const preceptors = d.people.filter((p) => p.precepts), others = d.people.filter((p) => p.otherDiscipline);
  const score = d.sets.reduce((a, s) => ({ requiredProvided: a.requiredProvided + s.score.requiredProvided, required: a.required + s.score.required, unverified: a.unverified + s.score.unverified, unknown: a.unknown + s.score.unknown }), { requiredProvided: 0, required: 0, unverified: 0, unknown: 0 });
  const steps: { key: string; label: string; done: boolean; href: string }[] = [
    { key: "location", label: "located", done: site.lat != null && !!site.address, href: "#location" },
    { key: "agreement", label: "agreement secured", done: fs?.agreementStatus === "secured", href: "#agreement" },
    ...(fam.accreditor ? [{ key: "accreditor", label: `${fam.accreditor} recognized`, done: fs?.accreditorStatus === "recognized", href: "#accreditor" }] : []),
    { key: "availability", label: "availability agreed", done: !!(fs?.studentsAtOnce || fs?.casesPerDay || fs?.daysAllowed || fs?.blocksAllowed), href: "#availability" },
    { key: "assets", label: "assets mapped", done: familyAssets.length > 0, href: "#assets" },
    { key: "staff", label: "qualified staff", done: d.preceptorsInDiscipline > 0 || (fs?.qualifiedStaffOnShift ?? 0) > 0, href: "#staff" },
    { key: "provides", label: "experiences confirmed", done: score.required > 0 && score.unverified === 0 && score.unknown === 0, href: "#provides" },
  ];
  const days = csv(fs?.daysAllowed), blocks = csv(fs?.blocksAllowed);
  const impliedCases = fs?.casesPerDay ?? (site.annualSurgicalCases != null ? site.annualSurgicalCases / Math.max(1, fam.caseDaysPerYear ?? 250) : null);
  let n = 0; const next = () => ++n;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500"><Link href={base} className="hover:text-slate-700">← Clinical sites &amp; requirements</Link></div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{site.name}</h2>
            <p className="text-sm text-slate-500">{[site.organization, site.facilityType].filter(Boolean).join(" · ")}{site.address || site.city ? <> · {[site.address, [site.city, site.state].filter(Boolean).join(", ")].filter(Boolean).join(", ")}</> : <span className="text-amber-700"> · no address on file</span>} · <Link href={`/employers/${site.id}`} className="text-rose-600 hover:underline">organization record</Link></p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {site.ring && <a href="#location" className={`rounded-full px-3 py-1 text-xs font-medium ${RING[site.ring] ?? "bg-slate-100"}`}>{site.ring}{site.driveMinutes != null ? ` · ${Math.round(site.driveMinutes)} min` : ""}</a>}
            <a href="#agreement" className={`rounded-full px-3 py-1 text-xs font-medium ${AGREEMENT[fs?.agreementStatus ?? "none"]}`}>{fs ? fs.agreementStatus : "not in this program yet"}</a>
            {fam.accreditor && <a href="#accreditor" className={`rounded-full px-3 py-1 text-xs font-medium ${fs?.accreditorStatus === "recognized" ? "bg-emerald-100 text-emerald-700" : fs?.accreditorStatus === "requested" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{fam.accreditor}: {fs?.accreditorStatus ?? "none"}{fs?.approvedCapacity != null ? ` · ${fs.approvedCapacity} at once` : ""}</a>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {steps.map((s, i) => <a key={s.key} href={s.href} className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${s.done ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-rose-300"}`}>{s.done ? "✓" : `${i + 1}`} {s.label}</a>)}
          <span className="self-center text-[11px] text-slate-400">{steps.filter((s) => s.done).length} of {steps.length} done</span>
        </div>
      </div>

      <Section id="location" n={next()} title="Where it is" sub={`drive from ${d.campus?.name ?? "the main campus"}, auto-coded from the address`} right={<form action={relocateSite.bind(null, site.id)}><button className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Re-locate</button></form>}>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>Ring: {site.ring ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RING[site.ring] ?? ""}`}>{site.ring}</span> : <span className="text-amber-600">not located</span>}{site.ringSource === "manual" && <span className="text-[11px] text-slate-400"> (set by hand)</span>}</span>
          <span>Drive: <strong className="tabular-nums">{site.driveMinutes != null ? `${Math.round(site.driveMinutes)} min` : "—"}</strong>{site.distanceMiles != null && <span className="text-slate-500"> · {dec(site.distanceMiles, 1)} mi straight-line</span>}</span>
          <span className="text-slate-500">Bands: Core ≤ {d.bands.core} · Ring 1 ≤ {d.bands.one} · Ring 2 ≤ {d.bands.two} min</span>
          <span className="text-slate-500">{site.geoSource === "census" ? "street-level fix" : site.geoSource === "gazetteer" ? "town-centre fix (±1–2 mi)" : site.geoSource === "manual" ? "pinned by hand" : "not located"} · <Link href={`/employers/${site.id}#location`} className="text-rose-600 hover:underline">correct the address or pin</Link></span>
        </div>
      </Section>

      <Section id="agreement" n={next()} title={`Agreement with ${fam.name}`} sub="this program's own affiliation and contact">
        <form action={upsertFamilySite.bind(null, fam.id, site.id)} className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
          <label className="block"><span className={lbl}>Agreement</span><select name="agreementStatus" defaultValue={fs?.agreementStatus ?? "prospect"} className={inp + " w-full font-medium"}>{["none", "prospect", "asked", "secured", "declined"].map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
          <label className="block"><span className={lbl}>Clinical contact</span><input name="contactName" defaultValue={fs?.contactName ?? site.contactName ?? ""} className={inp + " w-full"} /></label>
          <label className="block"><span className={lbl}>Contact email</span><input name="contactEmail" type="email" defaultValue={fs?.contactEmail ?? site.contactEmail ?? ""} className={inp + " w-full"} /></label>
          <label className="block lg:col-span-2"><span className={lbl}>Terms &amp; notes</span><input name="notes" defaultValue={fs?.notes ?? ""} placeholder="who signed, when, renewal, orientation, badge lead time" className={inp + " w-full"} /></label>
          <div className="flex items-center gap-3 lg:col-span-5"><button className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700">{fs ? "Save agreement" : `Add to ${fam.name}`}</button>{fs && <button formAction={removeFamilySite.bind(null, fam.id, site.id)} className="text-[11px] text-slate-400 hover:text-rose-600">Remove from {fam.name}</button>}</div>
        </form>
      </Section>

      {fam.accreditor && d.accreditorReport && d.accreditorSite && (
        <Section id="accreditor" n={next()} title={`${fam.accreditor} recognition & capacity`} sub="Form 1010R — the lower of physical resources and qualified staff on shift">
          <AccreditorCapacity report={d.accreditorReport} mode="site" />
        </Section>
      )}

      <Section id="availability" n={next()} title={`Availability agreed for ${fam.name}`} sub={fam.capacityBasis === "cases" ? `counted by cases: daily cases ÷ ${dec(fam.casesPerStudentDay ?? 2)} per student-day` : fam.capacityBasis === "staff" ? `counted by staff: qualified staff on shift × ${dec(fam.studentsPerStaff ?? 1)} students` : `counted by seats on the assets below, capped by students-at-once${fam.accreditor ? ` and the ${fam.accreditor} approval` : ""}`}>
        <form action={updateSiteAvailability.bind(null, fam.id, site.id)} className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-6">
          <label className="block"><span className={lbl}>Students at once</span><input name="studentsAtOnce" type="number" min="0" step="1" defaultValue={fs?.studentsAtOnce ?? ""} placeholder={fs?.approvedCapacity != null ? `${fs.approvedCapacity} (approved)` : "no cap"} className={inp + " w-full"} /></label>
          {fam.capacityBasis === "cases" && <label className="block"><span className={lbl}>Cases per day here</span><input name="casesPerDay" type="number" min="0" step="any" defaultValue={fs?.casesPerDay ?? ""} placeholder={impliedCases != null ? `≈ ${dec(impliedCases, 1)} from annual volume` : "cases / day"} className={inp + " w-full"} /></label>}
          {!fam.accreditor && <label className="block"><span className={lbl}>Qualified {d.discipline.label}s on shift</span><div className="flex gap-1"><input name="qualifiedStaffOnShift" type="number" min="0" step="1" defaultValue={fs?.qualifiedStaffOnShift ?? ""} className={inp + " w-full"} /><select name="staffCountSource" defaultValue={fs?.staffCountSource ?? "ESTIMATE"} className={inp}><option value="VERIFIED">verified</option><option value="ESTIMATE">estimate</option></select></div></label>}
          <div className="block lg:col-span-2"><span className={lbl}>Days <span className="font-normal normal-case text-slate-400">(blank = whenever the assets run)</span></span><div className="mt-1 flex flex-wrap gap-1">{DAYS.map((x) => <label key={x} className={`rounded px-1.5 py-0.5 ${days.includes(x) ? "bg-emerald-50 text-emerald-700" : "text-slate-500"}`}><input name={`day_${x}`} type="checkbox" defaultChecked={days.includes(x)} className="mr-0.5 align-middle" />{x}</label>)}</div></div>
          <div className="block"><span className={lbl}>Shifts</span><div className="mt-1 flex flex-wrap gap-1">{BLOCKS.map((x) => <label key={x} className={`rounded px-1.5 py-0.5 ${blocks.includes(x) ? "bg-emerald-50 text-emerald-700" : "text-slate-500"}`}><input name={`block_${x}`} type="checkbox" defaultChecked={blocks.includes(x)} className="mr-0.5 align-middle" />{x}</label>)}</div></div>
          <label className="block sm:col-span-2 lg:col-span-5"><span className={lbl}>Notes</span><input name="availabilityNotes" defaultValue={fs?.availabilityNotes ?? ""} placeholder="orientation dates, badge lead time, no students on call, parking …" className={inp + " w-full"} /></label>
          <div className="flex items-end"><button className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Save availability</button></div>
        </form>
      </Section>

      <Section id="assets" n={next()} title="Assets & shift structures" sub={`every ${d.settings.join(", ")} room, unit or machine ${fam.name} students can be placed on here`} right={<span className="text-xs text-slate-500">{familyAssets.length} asset{familyAssets.length === 1 ? "" : "s"} · {Object.entries(seatsBySetting).map(([k, v]) => `${k} ${v}`).join(" · ") || "none yet"}</span>}>
        <AssetRoster employerId={site.id} siteName={site.name} siteExternalId={site.externalId} assets={familyAssets} settings={settingOptions} programName={fam.name} organizationHref={`/employers/${site.id}`} />
        {otherAssets.length > 0 && <p className="mt-2 text-[11px] text-slate-400">{otherAssets.length} other asset{otherAssets.length === 1 ? "" : "s"} here belong to other programs&apos; settings ({Object.entries(otherAssets.reduce<Record<string, number>>((m, a) => { m[a.settingCode] = (m[a.settingCode] ?? 0) + 1; return m; }, {})).map(([k, v]) => `${v} ${k}`).join(", ")}) — see the <Link href={`/employers/${site.id}`} className="text-rose-600 hover:underline">organization record</Link>.</p>}
      </Section>

      <Section id="staff" n={next()} title={`Qualified staff who precept ${fam.name} here`} sub={d.discipline.credential}>
        <div className="grid gap-3 text-xs lg:grid-cols-2">
          <div>
            {preceptors.length === 0 ? <p className="text-amber-700">No {d.discipline.label} on record here. Add people under <Link href="/people" className="text-rose-600 hover:underline">People</Link> with this site as their employer.</p> : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">{preceptors.map((p) => <li key={p.id} className="flex items-center justify-between px-2 py-1"><span><span className="font-medium text-slate-800">{p.name}</span> <span className="text-slate-500">· {p.title ?? p.role}</span></span><span className="text-[10px] text-slate-400">{p.asset ? `${p.asset.setting} ${p.asset.assetNumber}` : ""}{p.email ? ` · ${p.email}` : ""}</span></li>)}</ul>
            )}
            {others.length > 0 && <p className="mt-1 text-[11px] text-slate-400">{others.length} other preceptor{others.length === 1 ? "" : "s"} here work in another discipline and do not count for {fam.name}.</p>}
          </div>
          <p className="rounded-lg bg-slate-50 p-3 text-slate-600">{fs?.qualifiedStaffOnShift != null ? <><strong>{fs.qualifiedStaffOnShift}</strong> qualified {d.discipline.label}s on shift during student hours{fs.studentHoursWindow ? ` (${fs.studentHoursWindow})` : ""} — {fs.staffCountSource === "VERIFIED" ? "verified" : "estimate"}. </> : <>Qualified {d.discipline.label}s on shift during student hours: not recorded yet{fam.accreditor ? " — enter it in the recognition block above." : " — enter it under availability."} </>}{fam.accreditor === "JRCERT" ? "JRCERT: students never outnumber the qualified radiographers on shift." : fam.capacityBasis === "cases" ? "A CST / CSFA or OR RN is on every case a student logs and signs the entry." : `${dec(fam.studentsPerStaff ?? 1)} students per qualified staff member.`}</p>
        </div>
      </Section>

      <section id="provides" className="scroll-mt-16 space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">{next()} · What this site provides toward completion <span className="font-normal text-slate-400">— inferred from its assets until confirmed; what is missing here must come from another site</span></h2>
        {d.sets.length === 0 && <p className="text-xs text-amber-700">No requirement set is loaded for {fam.name}.</p>}
        {d.sets.map((set) => (
          <div key={set.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-slate-800">{set.name} <span className="font-normal text-slate-500">— {set.authority}</span>{!set.verified && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">starter content — verify the list</span>}</div>
            <SiteProvisionChecklist familyId={fam.id} employerId={site.id} siteName={site.name} set={set} kind={set.kind} />
          </div>
        ))}
      </section>

      {d.sections.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">{d.sections.length} {fam.name} section{d.sections.length === 1 ? "" : "s"} booked here</summary>
          <div className="mt-2 overflow-x-auto"><table className="min-w-full text-xs"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Offering</th><th className="px-3 py-2 font-semibold">Course · section</th><th className="px-3 py-2 font-semibold">When</th><th className="px-3 py-2 text-right font-semibold">Seats</th><th className="px-3 py-2 font-semibold">Preceptor</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.sections.map((m) => <tr key={m.id}><td className="px-3 py-1.5"><Link href={`/programs/${m.cohort.programId}/offerings/${m.cohort.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{m.cohort.name}</Link></td><td className="px-3 py-1.5">{m.course.code ?? m.course.name} §{m.sectionIndex}/{m.sectionCount}</td><td className="px-3 py-1.5 tabular-nums">{m.dayOfWeek} {m.startTime} · {dec(m.lengthHours)} h</td><td className="px-3 py-1.5 text-right tabular-nums">{m.seats}</td><td className={`px-3 py-1.5 ${m.staff ? "" : "text-amber-600"}`}>{m.staff ?? "unassigned"}</td></tr>)}</tbody></table></div>
        </details>
      )}
    </div>
  );
}
