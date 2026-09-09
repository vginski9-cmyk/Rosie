import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamilySiteSetup } from "@/lib/queries";
import { upsertFamilySite, removeFamilySite, updateSiteAvailability, relocateSite } from "@/lib/actions";
import { AssetRoster } from "@/components/AssetRoster";
import { AccreditorCapacity } from "@/components/AccreditorCapacity";
import { SiteProvisionChecklist } from "@/components/SiteProvisionChecklist";
import { SETTING_PRESETS } from "@/lib/settingPresets";
import { dec } from "@/lib/format";

export const dynamic = "force-dynamic";

// ONE SITE, SET UP FOR ONE PROGRAM — everything the program needs from a clinical site,
// in the order a coordinator fills it in: where it is, the agreement, the accreditor's
// recognition, the availability it agreed, its assets and their shift structures, the
// qualified staff who precept there, and — item by item — which of the program's
// required experiences it provides. Nothing here is shared with another program.

const AGREEMENT: Record<string, string> = { none: "bg-slate-100 text-slate-500", prospect: "bg-sky-100 text-sky-700", asked: "bg-amber-100 text-amber-700", secured: "bg-emerald-100 text-emerald-700", declined: "bg-rose-100 text-rose-700" };
const RING: Record<string, string> = { Core: "bg-emerald-100 text-emerald-800", "Ring 1": "bg-sky-100 text-sky-800", "Ring 2": "bg-amber-100 text-amber-800", "Ring 3": "bg-rose-100 text-rose-800" };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], BLOCKS = ["Day", "Evening", "Night"];
const inp = "rounded border border-slate-300 px-2 py-1 text-xs";
const lbl = "block text-[10px] font-semibold uppercase tracking-wide text-slate-500";
const csv = (v: string | null | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export default async function FamilySitePage({ params }: { params: { id: string; employerId: string } }) {
  const d = await getFamilySiteSetup(params.id, params.employerId);
  if (!d) notFound();
  const { family: fam, site, familySite: fs } = d;
  const year = new Date().getUTCFullYear() + 1;
  const familyAssets = d.assets.filter((a) => a.inFamily);
  const seatsBySetting: Record<string, number> = {}; for (const a of familyAssets) if (a.status !== "archived") seatsBySetting[a.settingCode] = (seatsBySetting[a.settingCode] ?? 0) + a.learnersPerShift;
  const otherAssets = d.assets.filter((a) => !a.inFamily);
  // Only this program's settings can be added here — a surgical technology coordinator never builds a radiographic room.
  const settingOptions = d.settings.map((code) => ({ code, name: SETTING_PRESETS.find((p) => p[0] === code)?.[1] ?? d.areas.find((a) => csv(a.settingCodes).includes(code))?.name ?? code, assetType: SETTING_PRESETS.find((p) => p[0] === code)?.[2] }));
  const preceptors = d.people.filter((p) => p.precepts), others = d.people.filter((p) => p.otherDiscipline), staffOther = d.people.filter((p) => !p.precepts && !p.otherDiscipline);
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

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500"><Link href="/clinical" className="hover:text-slate-700">Clinical setup by program</Link><span>›</span><Link href={`/families/${fam.id}/clinical`} className="hover:text-slate-700">{fam.name}</Link><span>›</span><span className="text-slate-700">{site.name}</span></div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{site.name} <span className="text-base font-normal text-slate-400">— set up for {fam.name}</span></h1>
            <p className="text-sm text-slate-500">{[site.organization, site.facilityType].filter(Boolean).join(" · ")}{site.address || site.city ? <> · {[site.address, [site.city, site.state].filter(Boolean).join(", "), site.zip].filter(Boolean).join(" · ")}</> : <span className="text-amber-700"> · no address on file</span>} · <Link href={`/employers/${site.id}`} className="text-rose-600 hover:underline">organization record</Link></p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {site.ring && <a href="#location" className={`rounded-full px-3 py-1 text-xs font-medium ${RING[site.ring] ?? "bg-slate-100"}`}>{site.ring}{site.driveMinutes != null ? ` · ≈ ${Math.round(site.driveMinutes)} min` : ""}</a>}
            <a href="#agreement" className={`rounded-full px-3 py-1 text-xs font-medium ${AGREEMENT[fs?.agreementStatus ?? "none"]}`}>{fs ? fs.agreementStatus : "not in this program yet"}</a>
            {fam.accreditor && <a href="#accreditor" className={`rounded-full px-3 py-1 text-xs font-medium ${fs?.accreditorStatus === "recognized" ? "bg-emerald-100 text-emerald-700" : fs?.accreditorStatus === "requested" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{fam.accreditor}: {fs?.accreditorStatus ?? "none"}{fs?.approvedCapacity != null ? ` · ${fs.approvedCapacity} at once` : ""}</a>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {steps.map((s, i) => <a key={s.key} href={s.href} className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${s.done ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-rose-300"}`}>{s.done ? "✓" : `${i + 1}`} {s.label}</a>)}
          <span className="self-center text-[11px] text-slate-400">{steps.filter((s) => s.done).length} of {steps.length} done</span>
        </div>
      </div>

      {/* 1 · Where it is */}
      <section id="location" className="scroll-mt-16 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-sm font-semibold text-slate-700">1 · Where it is <span className="font-normal text-slate-400">— drive from {d.campus?.name ?? "the main campus"}{d.campus?.city ? ` (${d.campus.city})` : ""}, auto-coded from the address</span></h2>
            <p className="mt-0.5 text-xs text-slate-500">Bands for {fam.institution}: Core ≤ {d.bands.core} min · Ring 1 ≤ {d.bands.one} · Ring 2 ≤ {d.bands.two} · Ring 3 beyond. Change the address, pin a coordinate or override the ring on the <Link href={`/employers/${site.id}#location`} className="text-rose-600 hover:underline">organization record</Link>.</p></div>
          <form action={relocateSite.bind(null, site.id)}><button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Re-locate from address</button></form>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 px-3 py-2"><div className={lbl}>Ring</div><div className="mt-0.5 text-lg font-semibold">{site.ring ? <span className={`rounded-full px-2 py-0.5 text-sm ${RING[site.ring] ?? ""}`}>{site.ring}</span> : <span className="text-amber-600">not located</span>}</div><div className="text-[11px] text-slate-500">{site.ringSource === "manual" ? "overridden by hand" : "from the drive time"}</div></div>
          <div className="rounded-lg border border-slate-200 px-3 py-2"><div className={lbl}>Drive from campus</div><div className="mt-0.5 text-lg font-semibold tabular-nums">{site.driveMinutes != null ? `≈ ${Math.round(site.driveMinutes)} min` : "—"}</div><div className="text-[11px] text-slate-500">{site.distanceMiles != null ? `${dec(site.distanceMiles, 1)} mi straight-line · ≈ ${dec(site.distanceMiles * 1.25, 1)} road mi` : "not computed"}</div></div>
          <div className="rounded-lg border border-slate-200 px-3 py-2"><div className={lbl}>Coordinates</div><div className="mt-0.5 font-mono text-sm tabular-nums">{site.lat != null && site.lng != null ? `${dec(site.lat, 4)}, ${dec(site.lng, 4)}` : <span className="text-amber-600">not located</span>}</div><div className="text-[11px] text-slate-500">{site.geoSource === "census" ? "Census geocoder — street-level" : site.geoSource === "gazetteer" ? "built-in gazetteer — town centre (±1–2 mi)" : site.geoSource === "manual" ? "pinned by hand" : "no source"}</div></div>
        </div>
      </section>

      {/* 2 · Agreement for this program */}
      <section id="agreement" className="scroll-mt-16 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">2 · Agreement with {fam.name} <span className="font-normal text-slate-400">— this program&apos;s own affiliation, contact and terms; other programs keep theirs</span></h2>
        <form action={upsertFamilySite.bind(null, fam.id, site.id)} className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
          <label className="block"><span className={lbl}>Agreement</span><select name="agreementStatus" defaultValue={fs?.agreementStatus ?? "prospect"} className={inp + " w-full font-medium"}>{["none", "prospect", "asked", "secured", "declined"].map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
          <label className="block"><span className={lbl}>Clinical contact</span><input name="contactName" defaultValue={fs?.contactName ?? site.contactName ?? ""} className={inp + " w-full"} /></label>
          <label className="block"><span className={lbl}>Contact email</span><input name="contactEmail" type="email" defaultValue={fs?.contactEmail ?? site.contactEmail ?? ""} className={inp + " w-full"} /></label>
          <label className="block lg:col-span-2"><span className={lbl}>Terms &amp; notes (who signed, when, renewal, orientation, badge lead time)</span><input name="notes" defaultValue={fs?.notes ?? ""} className={inp + " w-full"} /></label>
          <div className="flex items-center gap-2 lg:col-span-5"><button className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700">{fs ? "Save agreement" : `Add to ${fam.name}`}</button>{fs && <span className="text-[11px] text-slate-400">Secured is what the scheduler places students against; asked sites only when the program&apos;s rules allow it.</span>}</div>
        </form>
        {fs && <form action={removeFamilySite.bind(null, fam.id, site.id)} className="mt-2"><button className="text-[11px] text-slate-400 hover:text-rose-600">Remove this site from {fam.name}&apos;s setup (the organization record and its assets stay)</button></form>}
      </section>

      {/* 3 · Accreditor recognition (JRCERT Form 1010R for radiography) */}
      {fam.accreditor && d.accreditorReport && d.accreditorSite && (
        <section id="accreditor" className="scroll-mt-16 space-y-2">
          <div><h2 className="text-lg font-semibold">3 · {fam.accreditor} recognition &amp; capacity <span className="text-sm font-normal text-slate-400">— Form 1010R: the lower of physical resources and qualified radiographers on shift</span></h2>
            <p className="max-w-4xl text-sm text-slate-500">The JRCERT recognizes each clinical setting and sets its capacity at the lower of two counts on its campus: radiographic + R&amp;F rooms plus mobile + C-arm units (counted from the assets below), and the qualified radiographers scheduled while students are on site (recorded here). Students are supervised 1:1 by a qualified radiographer — directly until competency is documented, indirectly after, and directly again for every repeat exposure — so the staff count, not the rooms, is usually the binding number. The program may never assign more students here at once than the approved capacity.</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><AccreditorCapacity report={d.accreditorReport} mode="site" /></div>
        </section>
      )}

      {/* 4 · Availability agreed for this program */}
      <section id="availability" className="scroll-mt-16 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">{fam.accreditor ? "4" : "3"} · Availability agreed for {fam.name} <span className="font-normal text-slate-400">— the hard limits the scheduler places students within at this site</span></h2>
        <p className="mt-0.5 text-xs text-slate-500">{fam.capacityBasis === "cases" ? `${fam.name} counts availability by cases: a student needs ${dec(fam.casesPerStudentDay ?? 2)} cases a day, so a site takes (daily cases ÷ ${dec(fam.casesPerStudentDay ?? 2)}) students on a case day.` : fam.capacityBasis === "staff" ? `${fam.name} counts availability by staff: qualified staff on shift × ${dec(fam.studentsPerStaff ?? 1)} students each.` : `${fam.name} counts availability by seats: the learners per shift on each asset below, capped by students-at-once${fam.accreditor ? ` and the ${fam.accreditor}-approved capacity` : ""}.`}</p>
        <form action={updateSiteAvailability.bind(null, fam.id, site.id)} className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-6">
          <label className="block"><span className={lbl}>Students at any one time</span><input name="studentsAtOnce" type="number" min="0" step="1" defaultValue={fs?.studentsAtOnce ?? ""} placeholder={fs?.approvedCapacity != null ? `${fs.approvedCapacity} (approved)` : "no cap"} className={inp + " w-full"} /></label>
          {fam.capacityBasis === "cases" && <label className="block"><span className={lbl}>{fam.name} cases per day here</span><input name="casesPerDay" type="number" min="0" step="any" defaultValue={fs?.casesPerDay ?? ""} placeholder={impliedCases != null ? `≈ ${dec(impliedCases, 1)} from annual volume` : "cases / day"} className={inp + " w-full"} /></label>}
          {!fam.accreditor && <label className="block"><span className={lbl}>Qualified {d.discipline.label}s on shift</span><div className="flex gap-1"><input name="qualifiedStaffOnShift" type="number" min="0" step="1" defaultValue={fs?.qualifiedStaffOnShift ?? ""} className={inp + " w-full"} /><select name="staffCountSource" defaultValue={fs?.staffCountSource ?? "ESTIMATE"} className={inp}><option value="VERIFIED">verified</option><option value="ESTIMATE">estimate</option></select></div></label>}
          <div className="block lg:col-span-2"><span className={lbl}>Days students may attend <span className="font-normal normal-case text-slate-400">(blank = whenever the assets run)</span></span><div className="mt-1 flex flex-wrap gap-1">{DAYS.map((x) => <label key={x} className={`rounded px-1.5 py-0.5 ${days.includes(x) ? "bg-emerald-50 text-emerald-700" : "text-slate-500"}`}><input name={`day_${x}`} type="checkbox" defaultChecked={days.includes(x)} className="mr-0.5 align-middle" />{x}</label>)}</div></div>
          <div className="block"><span className={lbl}>Shift blocks</span><div className="mt-1 flex flex-wrap gap-1">{BLOCKS.map((x) => <label key={x} className={`rounded px-1.5 py-0.5 ${blocks.includes(x) ? "bg-emerald-50 text-emerald-700" : "text-slate-500"}`}><input name={`block_${x}`} type="checkbox" defaultChecked={blocks.includes(x)} className="mr-0.5 align-middle" />{x}</label>)}</div></div>
          <label className="block sm:col-span-2 lg:col-span-6"><span className={lbl}>Notes</span><input name="availabilityNotes" defaultValue={fs?.availabilityNotes ?? ""} placeholder="orientation dates, badge lead time, no students on call, parking …" className={inp + " w-full"} /></label>
          <div><button className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Save availability</button></div>
        </form>
      </section>

      {/* 5 · Assets & shift structures */}
      <section id="assets" className="scroll-mt-16 space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="text-lg font-semibold">{fam.accreditor ? "5" : "4"} · Assets &amp; shift structures <span className="text-sm font-normal text-slate-400">— every room, unit or machine {fam.name} students can be placed on here</span></h2>
            <p className="max-w-4xl text-sm text-slate-500">{fam.name} places students in <span className="font-mono text-xs">{d.settings.join(", ")}</span>. Each asset: what it is, which days it runs, which shifts and how long each is, and how many learners a shift takes. {fam.accreditor === "JRCERT" ? "Radiographic and R&F rooms, mobile units and C-arms are what the JRCERT counts as physical capacity; CT, MRI and the like are excluded from the count but still host rotations." : ""} What a site provides toward completion (below) is inferred from these assets until confirmed.</p></div>
          <div className="text-xs text-slate-500">{familyAssets.length} {fam.name} asset{familyAssets.length === 1 ? "" : "s"} here · {Object.entries(seatsBySetting).map(([k, v]) => `${k} ${v}`).join(" · ") || "none yet"}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <AssetRoster employerId={site.id} siteName={site.name} siteExternalId={site.externalId} assets={familyAssets} settings={settingOptions} programName={fam.name} organizationHref={`/employers/${site.id}`} />
        </div>
        {otherAssets.length > 0 && (
          <details className="rounded-lg border border-dashed border-slate-300 bg-slate-50/40 px-3 py-2 text-xs text-slate-500">
            <summary className="cursor-pointer">{otherAssets.length} other asset{otherAssets.length === 1 ? "" : "s"} at this site belong to other programs&apos; settings and are not part of {fam.name}&apos;s setup ▸</summary>
            <div className="mt-1 flex flex-wrap gap-1">{Object.entries(otherAssets.reduce<Record<string, number>>((m, a) => { m[`${a.settingCode} · ${a.assetType}`] = (m[`${a.settingCode} · ${a.assetType}`] ?? 0) + 1; return m; }, {})).map(([k, n]) => <span key={k} className="rounded bg-white px-1.5 py-0.5 ring-1 ring-slate-200">{n} × {k}</span>)}</div>
            <p className="mt-1 text-[11px]">They are managed on the <Link href={`/employers/${site.id}`} className="text-rose-600 hover:underline">organization record</Link> and on the program that uses them.</p>
          </details>
        )}
      </section>

      {/* 6 · Qualified staff */}
      <section id="staff" className="scroll-mt-16 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">{fam.accreditor ? "6" : "5"} · Qualified staff who precept {fam.name} here <span className="font-normal text-slate-400">— {d.discipline.credential}</span></h2>
        <div className="mt-2 grid gap-3 lg:grid-cols-[1fr_1fr]">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{preceptors.length} {d.discipline.label}{preceptors.length === 1 ? "" : "s"} on record</div>
            {preceptors.length === 0 ? <p className="mt-1 text-xs text-amber-700">No {d.discipline.label} is on record at this site. Every clinical section booked here needs one; add people under <Link href="/people" className="text-rose-600 hover:underline">Directory → People</Link> with this site as their employer.</p> : (
              <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs">{preceptors.map((p) => <li key={p.id} className="flex items-center justify-between px-2 py-1"><span><span className="font-medium text-slate-800">{p.name}</span> <span className="text-slate-500">· {p.title ?? p.role}</span></span><span className="text-[10px] text-slate-400">{p.asset ? `${p.asset.setting} ${p.asset.assetNumber}` : ""}{p.email ? ` · ${p.email}` : ""}</span></li>)}</ul>
            )}
            {others.length > 0 && <p className="mt-1 text-[11px] text-slate-400">{others.length} other preceptor{others.length === 1 ? "" : "s"} here work in another discipline ({others.slice(0, 3).map((p) => p.title).join(", ")}) and do not count for {fam.name}.</p>}
            {staffOther.length > 0 && <p className="mt-1 text-[11px] text-slate-400">{staffOther.length} other staff on record (coordinators, instructors).</p>}
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-600">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">What counts</div>
            <p className="mt-1">{fs?.qualifiedStaffOnShift != null ? <><strong>{fs.qualifiedStaffOnShift}</strong> qualified {d.discipline.label}s are scheduled during student hours{fs.studentHoursWindow ? ` (${fs.studentHoursWindow})` : ""} — {fs.staffCountSource === "VERIFIED" ? "verified with the site" : "an estimate"}.</> : <>The number of qualified {d.discipline.label}s on shift during student hours is not recorded yet{fam.accreditor ? " — enter it in the recognition block above; it is the human-resource count Form 1010R asks for." : " — enter it under availability above."}</>}</p>
            <p className="mt-1">{fam.accreditor === "JRCERT" ? "JRCERT: students never outnumber the qualified radiographers on shift (1:1); a clinical preceptor with 2+ years post-certification experience is designated at each setting." : fam.capacityBasis === "cases" ? "A credentialed CST / CSFA or OR RN is scrubbed or circulating on every case a student logs; the preceptor signs each case-log entry." : `${dec(fam.studentsPerStaff ?? 1)} students per qualified staff member is this program's rule.`}</p>
          </div>
        </div>
      </section>

      {/* 7 · What this site provides toward completion */}
      <section id="provides" className="scroll-mt-16 space-y-3">
        <div><h2 className="text-lg font-semibold">{fam.accreditor ? "7" : "6"} · What {site.name.length > 34 ? "this site" : site.name} provides toward completion <span className="text-sm font-normal text-slate-400">— {fam.name}&apos;s required experiences, item by item</span></h2>
          <p className="max-w-4xl text-sm text-slate-500">{d.sets.length ? <>Every graduate must complete the list below. Each row says whether this site can give a student that experience — inferred from its assets until someone confirms it with the site — and how much of it the site does in a year, which is what limits how many students it can carry. What is missing here has to come from another site in {fam.name}&apos;s network.</> : <>No requirement set is loaded for {fam.name} — add the credentialing body&apos;s list on the program&apos;s clinical setup page.</>}</p></div>
        {d.sets.map((set) => (
          <div key={set.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-slate-800">{set.name} <span className="font-normal text-slate-500">— {set.authority}</span>{!set.verified && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">starter content — verify the list</span>}</div>
            <SiteProvisionChecklist familyId={fam.id} employerId={site.id} siteName={site.name} set={set} kind={set.kind} />
          </div>
        ))}
      </section>

      {/* Hosting */}
      <section id="hosting" className="scroll-mt-16 space-y-2">
        <h2 className="text-lg font-semibold">{fam.name} sections hosted here <span className="text-sm font-normal text-slate-400">— what the calendar has booked at this site for this program</span></h2>
        {d.sections.length === 0 ? <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">Nothing booked here for {fam.name} yet. Offerings build their clinical schedules from this setup.</p> : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-full text-xs"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Offering</th><th className="px-3 py-2 font-semibold">Course · section</th><th className="px-3 py-2 font-semibold">When</th><th className="px-3 py-2 text-right font-semibold">Seats</th><th className="px-3 py-2 font-semibold">Preceptor</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.sections.map((m) => <tr key={m.id}><td className="px-3 py-1.5"><Link href={`/programs/${m.cohort.programId}/offerings/${m.cohort.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{m.cohort.name}</Link></td><td className="px-3 py-1.5">{m.course.code ?? m.course.name} §{m.sectionIndex}/{m.sectionCount}</td><td className="px-3 py-1.5 tabular-nums">{m.dayOfWeek} {m.startTime} · {dec(m.lengthHours)} h</td><td className="px-3 py-1.5 text-right tabular-nums">{m.seats}</td><td className={`px-3 py-1.5 ${m.staff ? "" : "text-amber-600"}`}>{m.staff ?? "unassigned"}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </div>
  );
}
