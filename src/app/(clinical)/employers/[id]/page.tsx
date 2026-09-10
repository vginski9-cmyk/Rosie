import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployer, getAccreditedFamiliesForEmployer, getAccreditorCapacity, getSiteRequirementFit, getFamilyProgramId } from "@/lib/queries";
import { AccreditorCapacity } from "@/components/AccreditorCapacity";
import { updateEmployer, updatePlacementStatus, deletePlacement, createClinicalUnit, updateClinicalUnit, deleteClinicalUnit, setSiteGeography, relocateSite } from "@/lib/actions";
import { dec } from "@/lib/format";
import { AssetRoster } from "@/components/AssetRoster";
import { AssetBuilder } from "@/components/AssetBuilder";
import { Collapse } from "@/components/Collapse";
import { SETTING_PRESETS } from "@/lib/settingPresets";
import { caseVolumeLine } from "@/lib/surgvolume";

export const dynamic = "force-dynamic";

// THE ORGANIZATION RECORD — what a site is regardless of program: where it is, its assets and
// their shift structures, its units, its people and placements. What it means to a program
// (agreement, recognition, availability, what it provides) lives on that program's site page.

const EMP_STATUSES = ["prospect", "active", "paused", "archived"];
const PLACEMENT_NEXT: Record<string, string[]> = { planned: ["active", "cancelled"], active: ["completed", "cancelled"], completed: [], cancelled: ["planned"] };
const PSTATUS_BADGE: Record<string, string> = { planned: "bg-sky-100 text-sky-700", active: "bg-emerald-100 text-emerald-700", completed: "bg-slate-200 text-slate-600", cancelled: "bg-slate-100 text-slate-400" };
const RING_TONE: Record<string, string> = { Core: "bg-emerald-100 text-emerald-800", "Ring 1": "bg-sky-100 text-sky-800", "Ring 2": "bg-amber-100 text-amber-800", "Ring 3": "bg-rose-100 text-rose-800" };
const dateFmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
const inp = "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm";
const lbl = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400";

export default async function EmployerPage({ params }: { params: { id: string } }) {
  const e = await getEmployer(params.id);
  if (!e) notFound();
  const accreditedFamilies = await getAccreditedFamiliesForEmployer(e.id);
  const accreditorReports = (await Promise.all(accreditedFamilies.map((f) => getAccreditorCapacity(f.id, e.id)))).filter((r): r is NonNullable<typeof r> => !!r && r.sites.length > 0);
  const fit = (await getSiteRequirementFit(e.id)) ?? [];
  const programIds = new Map(await Promise.all(fit.map(async (f) => [f.family.id, await getFamilyProgramId(f.family.id)] as const)));
  const campus = e.institution.campuses[0] ?? null;
  const year = new Date().getUTCFullYear() + 1;
  const secured = e.placements.filter((p) => p.status === "active" || p.status === "completed").length;
  const liveAssets = e.assets.filter((a) => a.status !== "archived");
  const seatsBySetting: Record<string, number> = {}; for (const a of liveAssets) seatsBySetting[a.settingCode] = (seatsBySetting[a.settingCode] ?? 0) + a.learnersPerShift;
  const rosterAssets = e.assets.map((a) => ({ id: a.id, externalId: a.externalId, employerId: a.employerId, facilityName: e.name, facilityExternalId: e.externalId, county: e.county, ring: e.ring, facilityType: e.facilityType, agreementStatus: e.agreementStatus, facilityStatus: e.status, settingCode: a.settingCode, setting: a.setting, assetType: a.assetType, assetNumber: a.assetNumber, operatingRule: a.operatingRule, days: a.days, shiftBlocks: a.shiftBlocks, hoursPerShift: a.hoursPerShift, dayStart: a.dayStart, dayHours: a.dayHours, eveningStart: a.eveningStart, eveningHours: a.eveningHours, nightStart: a.nightStart, nightHours: a.nightHours, serves: a.serves, learnersPerShift: a.learnersPerShift, preceptorsPerShift: a.preceptorsPerShift, dataSource: a.dataSource, accreditorClass: a.accreditorClass, status: a.status, notes: a.notes, exceptions: a._count.dayOverrides }));
  const settings = SETTING_PRESETS.map(([code, name, assetType]) => ({ code, name, assetType }));
  const volumeLine = caseVolumeLine(e);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/employers" className="text-sm text-slate-500 hover:text-slate-700">← All organizations</Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{e.name}</h1>
            <p className="text-sm text-slate-500">{[e.organization, e.facilityType ?? e.setting, [e.address, [e.city, e.state].filter(Boolean).join(", "), e.zip].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || <span className="text-amber-700">No address on file — add one under details.</span>}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {e.ring ? <a href="#location" className={`rounded-full px-3 py-1 font-medium ${RING_TONE[e.ring] ?? "bg-slate-100 text-slate-600"}`}>{e.ring}{e.driveMinutes != null ? ` · ${Math.round(e.driveMinutes)} min from campus` : ""}</a> : <a href="#location" className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-700">not located</a>}
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600">{e.status}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{liveAssets.length} assets · {e.people.length} people</span>
            {volumeLine && <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-800 ring-1 ring-violet-200" title={e.surgicalCaseSource ?? ""}>{volumeLine}</span>}
          </div>
        </div>
      </div>

      {/* 1 · Programs this site serves */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1 · Programs this site serves <span className="text-sm font-normal text-slate-400">— agreement, recognition, availability and what it provides are set per program</span></h2>
        {fit.length === 0 ? <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">No program scores this site yet. Add it from a program&apos;s <Link href="/clinical" className="text-rose-600 hover:underline">clinical sites</Link> page.</p> : (
          <div className="grid gap-3 md:grid-cols-2">
            {fit.map((f) => f.sets.map((set) => {
              const pct = set.requiredItems ? set.requiredProvided / set.requiredItems : 0;
              const pid = programIds.get(f.family.id);
              const href = pid ? `/programs/${pid}/clinical/sites/${e.id}` : `/families/${f.family.id}/clinical/sites/${e.id}`;
              return (
                <Link key={set.id} href={href} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-rose-300 hover:bg-rose-50/30">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-base font-semibold text-slate-900">{f.family.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${f.agreement === "secured" ? "bg-emerald-100 text-emerald-800" : f.agreement === "asked" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"}`}>{f.inFamily ? f.agreement : "not in this program"}</span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between text-xs"><span className="text-slate-600">Required experiences provided here</span><span className={`font-semibold tabular-nums ${pct >= 1 ? "text-emerald-700" : pct > 0 ? "text-amber-700" : "text-slate-500"}`}>{set.requiredProvided} of {set.requiredItems}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><div className={`h-full ${pct >= 1 ? "bg-emerald-500" : pct >= 0.5 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${Math.round(pct * 100)}%` }} /></div>
                  <div className="mt-1 text-[11px] text-slate-500">{set.missingMandatory.length ? `missing: ${set.missingMandatory.slice(0, 3).join(", ")}${set.missingMandatory.length > 3 ? ` +${set.missingMandatory.length - 3}` : ""}` : "every required experience"}{set.unverified ? ` · ${set.unverified} unconfirmed` : ""}</div>
                  <div className="mt-2 text-[11px] font-medium text-rose-700">Set up for {f.family.name} →</div>
                </Link>
              );
            }))}
          </div>
        )}
      </section>

      {/* 2 · Assets & shift structures */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold">2 · Assets &amp; shift structures <span className="text-sm font-normal text-slate-400">— every room, unit and machine, which days and shifts it runs, and the learners a shift takes</span></h2>
          <span className="text-xs text-slate-500">{Object.entries(seatsBySetting).map(([k, v]) => `${k} ${v} seats`).join(" · ") || "none yet"}</span>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <AssetRoster employerId={e.id} siteName={e.name} siteExternalId={e.externalId} assets={rosterAssets} settings={settings} programName="" organizationHref="#exceptions" />
        </div>
        <div id="exceptions" className="scroll-mt-16">
          <Collapse title="Closures, exceptions & per-asset detail" sub="Close assets for a date range, the accreditor class of each room, and the year's shift totals" summary={<>{e.assetOverrides.length} exception day{e.assetOverrides.length === 1 ? "" : "s"} · <a href={`/api/asset-map?institutionId=${e.institutionId}&employerId=${e.id}&year=${year}`} className="text-rose-600 hover:underline">workbook ↓</a></>}>
            <AssetBuilder employerId={e.id} siteName={e.name} siteExternalId={e.externalId} year={year} assets={rosterAssets} overrides={e.assetOverrides} settings={settings} />
          </Collapse>
        </div>
      </section>

      {/* 3 · Details */}
      <Collapse title="3 · Details & contact" sub="Name, address, facility type, beds and operating rooms, contact" summary={<>{[e.facilityType, e.county ? `${e.county} County` : null, e.licensedBeds != null ? `${e.licensedBeds} beds` : null, e.operatingRooms != null ? `${e.operatingRooms} ORs` : null, e.annualSurgicalCases != null ? `${e.annualSurgicalCases.toLocaleString("en-US")} cases/yr` : null, e.contactName].filter(Boolean).join(" · ") || "not filled in"}</>}>
        <form action={updateEmployer.bind(null, e.id)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field name="name" label="Name" defaultValue={e.name} required />
          <Field name="organization" label="Organization / system" defaultValue={e.organization} />
          <label className="block"><span className={lbl}>Facility type</span>
            <select name="facilityType" defaultValue={e.facilityType ?? ""} className={inp}><option value="">—</option>{["Acute care hospital", "Specialty hospital", "Ambulatory surgery center", "Nursing home", "Combination home (NH + adult care)", "Adult care home", "Physician office / clinic", "Imaging center", "Behavioral health facility", "Home health / hospice", "Public health / community", "Other"].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label className="block"><span className={lbl}>Status</span><select name="status" defaultValue={e.status} className={inp}>{EMP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <Field name="address" label="Street address" defaultValue={e.address} />
          <Field name="city" label="City" defaultValue={e.city} />
          <Field name="state" label="State" defaultValue={e.state} />
          <Field name="zip" label="ZIP" defaultValue={e.zip} />
          <Field name="county" label="County" defaultValue={e.county} />
          <Field name="setting" label="Setting (short label)" defaultValue={e.setting} />
          <Field name="licensedBeds" label="Licensed acute beds" type="number" defaultValue={e.licensedBeds != null ? String(e.licensedBeds) : ""} />
          <Field name="operatingRooms" label="Operating rooms" type="number" defaultValue={e.operatingRooms != null ? String(e.operatingRooms) : ""} />
          <Field name="annualSurgicalCases" label="Annual surgical cases" type="number" defaultValue={e.annualSurgicalCases != null ? String(e.annualSurgicalCases) : ""} />
          <Field name="inpatientSurgicalCases" label="of which inpatient" type="number" defaultValue={e.inpatientSurgicalCases != null ? String(e.inpatientSurgicalCases) : ""} />
          <Field name="ambulatorySurgicalCases" label="of which ambulatory" type="number" defaultValue={e.ambulatorySurgicalCases != null ? String(e.ambulatorySurgicalCases) : ""} />
          <Field name="operatingDaysPerYear" label="Operating days a year" type="number" defaultValue={e.operatingDaysPerYear != null ? String(e.operatingDaysPerYear) : ""} />
          <Field name="surgicalCaseSource" label="Case volume source / period" defaultValue={e.surgicalCaseSource} />
          <Field name="nursingHomeBeds" label="Nursing home beds" type="number" defaultValue={e.nursingHomeBeds != null ? String(e.nursingHomeBeds) : ""} />
          <Field name="adultCareBeds" label="Adult care beds" type="number" defaultValue={e.adultCareBeds != null ? String(e.adultCareBeds) : ""} />
          <label className="block"><span className={lbl}>Umbrella agreement</span><select name="agreementStatus" defaultValue={e.agreementStatus} className={inp}>{["none", "prospect", "asked", "secured", "declined"].map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
          <Field name="contactName" label="Contact name" defaultValue={e.contactName} />
          <Field name="contactEmail" label="Contact email" type="email" defaultValue={e.contactEmail} />
          <Field name="contactPhone" label="Contact phone" defaultValue={e.contactPhone} />
          <Field name="agreementNotes" label="Agreement notes" defaultValue={e.agreementNotes} />
          <label className="block sm:col-span-2 lg:col-span-4"><span className={lbl}>Notes</span><textarea name="notes" defaultValue={e.notes ?? ""} rows={2} className={inp} /></label>
          <div className="lg:col-span-4"><button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Save details</button></div>
        </form>
      </Collapse>

      {/* 4 · Location */}
      <div id="location" className="scroll-mt-16">
        <Collapse title="4 · Location & drive time" sub={`Auto-coded from the address; the ring follows the drive from ${campus?.name ?? "the main campus"}`} summary={<>{e.ring ?? "not located"}{e.driveMinutes != null ? ` · ${Math.round(e.driveMinutes)} min` : ""}{e.lat != null && e.lng != null ? ` · ${dec(e.lat, 3)}, ${dec(e.lng, 3)}` : ""}</>}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div className="rounded-lg border border-slate-200 px-3 py-2"><div className={lbl}>Ring</div><div className="text-lg font-semibold">{e.ring ? <span className={`rounded-full px-2 py-0.5 text-sm ${RING_TONE[e.ring] ?? "bg-slate-100"}`}>{e.ring}</span> : <span className="text-amber-600">—</span>}</div><div className="text-[11px] text-slate-500">{e.ringSource === "manual" ? "set by hand" : `from the drive time · Core ≤ ${e.institution.ringCoreMinutes} · Ring 1 ≤ ${e.institution.ringOneMinutes} · Ring 2 ≤ ${e.institution.ringTwoMinutes} min`}</div></div>
            <div className="rounded-lg border border-slate-200 px-3 py-2"><div className={lbl}>Drive from campus</div><div className="text-lg font-semibold tabular-nums">{e.driveMinutes != null ? `${Math.round(e.driveMinutes)} min` : "—"}</div><div className="text-[11px] text-slate-500">{e.distanceMiles != null ? `${dec(e.distanceMiles, 1)} mi straight-line` : "not computed"}</div></div>
            <div className="rounded-lg border border-slate-200 px-3 py-2"><div className={lbl}>Coordinates</div><div className="font-mono text-sm tabular-nums">{e.lat != null && e.lng != null ? `${dec(e.lat, 4)}, ${dec(e.lng, 4)}` : <span className="text-amber-600">not located</span>}</div><div className="text-[11px] text-slate-500">{e.geoSource === "census" ? "street-level" : e.geoSource === "gazetteer" ? "town centre (±1–2 mi)" : e.geoSource === "manual" ? "pinned by hand" : "no source"}</div><form action={relocateSite.bind(null, e.id)} className="mt-1"><button className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50">Re-locate from address</button></form></div>
            <form action={setSiteGeography.bind(null, e.id)} className="rounded-lg border border-slate-200 px-3 py-2">
              <div className={lbl}>Correct it</div>
              <label className="block">ring <select name="ring" defaultValue={e.ringSource === "manual" ? e.ring ?? "auto" : "auto"} className="ml-1 rounded border border-slate-300 px-1.5 py-0.5"><option value="auto">auto</option>{["Core", "Ring 1", "Ring 2", "Ring 3"].map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
              <div className="mt-1 flex items-center gap-1">pin <input name="lat" placeholder="lat" defaultValue={e.geoSource === "manual" && e.lat != null ? String(e.lat) : ""} className="w-20 rounded border border-slate-300 px-1.5 py-0.5 font-mono" /><input name="lng" placeholder="lng" defaultValue={e.geoSource === "manual" && e.lng != null ? String(e.lng) : ""} className="w-20 rounded border border-slate-300 px-1.5 py-0.5 font-mono" /></div>
              <button className="mt-1.5 rounded bg-slate-800 px-2.5 py-1 font-medium text-white hover:bg-slate-700">Apply</button>
            </form>
          </div>
        </Collapse>
      </div>

      {/* 5 · Accreditor reports */}
      {accreditorReports.map((r) => (
        <Collapse key={r.family.id} title={`${r.family.accreditor ?? "JRCERT"} capacity — ${r.family.name}`} sub="Form 1010R from this site's assets and record" summary={<>{r.sites[0]?.status ?? "none"}</>}>
          <AccreditorCapacity report={r} mode="site" />
        </Collapse>
      ))}

      {/* 6 · Functional units */}
      <Collapse title="Functional units" sub="Beds, rooms and stations by unit with shift blocks and students per shift — the older grain some bookings still point at" summary={<>{e.units.length} unit{e.units.length === 1 ? "" : "s"}</>}>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-2 py-2 font-semibold">Unit</th><th className="px-2 py-2 font-semibold">Category</th><th className="px-2 py-2 font-semibold">Capacity</th><th className="px-2 py-2 font-semibold">Source</th><th className="px-2 py-2 font-semibold">Shifts / day · hrs</th><th className="px-2 py-2 font-semibold">Blocks</th><th className="px-2 py-2 font-semibold">Days</th><th className="px-2 py-2 font-semibold">Students / shift</th><th className="px-2 py-2 font-semibold">Per preceptor</th><th className="px-2 py-2 font-semibold">Preceptors / shift</th><th className="px-2 py-2 text-right font-semibold">Weekly slots</th><th className="px-2 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...e.units, null].map((u) => {
                const isNew = u == null;
                const days = (u?.days ?? "Mon,Tue,Wed,Thu,Fri").split(",");
                const blocks = (u?.shiftBlocks ?? "Day").split(",");
                const fid = isNew ? "unit-new" : `unit-${u.id}`;
                return (
                  <tr key={u?.id ?? "new"} className={isNew ? "bg-rose-50/30" : ""}>
                    <td className="px-2 py-1.5"><input form={fid} name="unitType" defaultValue={u?.unitType ?? ""} placeholder="new unit" className="w-36 rounded border border-slate-300 px-1.5 py-1" /></td>
                    <td className="px-2 py-1.5"><select form={fid} name="unitCategory" defaultValue={u?.unitCategory ?? "Inpatient beds"} className="rounded border border-slate-300 px-1.5 py-1">{["Inpatient beds", "Surgical", "Emergency", "Imaging", "Laboratory", "Long-term care beds", "Adult care beds", "Behavioral health", "Ambulatory office", "Community"].map((c) => <option key={c} value={c}>{c}</option>)}</select></td>
                    <td className="px-2 py-1.5 whitespace-nowrap"><input form={fid} name="capacityCount" type="number" step="any" defaultValue={u?.capacityCount ?? ""} className="w-14 rounded border border-slate-300 px-1.5 py-1 text-right" /> <input form={fid} name="uom" defaultValue={u?.uom ?? "beds"} className="w-14 rounded border border-slate-300 px-1.5 py-1" /></td>
                    <td className="px-2 py-1.5"><select form={fid} name="dataSource" defaultValue={u?.dataSource ?? "ESTIMATE"} className="rounded border border-slate-300 px-1.5 py-1">{["VERIFIED", "ESTIMATE", "GAP"].map((d) => <option key={d} value={d}>{d}</option>)}</select></td>
                    <td className="px-2 py-1.5 whitespace-nowrap"><input form={fid} name="shiftsPerDay" type="number" defaultValue={u?.shiftsPerDay ?? 2} className="w-10 rounded border border-slate-300 px-1.5 py-1 text-right" /> × <input form={fid} name="shiftLengthHrs" type="number" step="any" defaultValue={u?.shiftLengthHrs ?? 12} className="w-12 rounded border border-slate-300 px-1.5 py-1 text-right" />h</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{["Day", "Evening", "Night"].map((b) => <label key={b} className="mr-1.5 inline-flex items-center gap-0.5"><input form={fid} type="checkbox" name={`block_${b}`} defaultChecked={blocks.includes(b)} />{b[0]}</label>)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <label key={d} className="mr-1 inline-flex items-center gap-0.5"><input form={fid} type="checkbox" name={`day_${d}`} defaultChecked={days.includes(d)} />{d[0]}</label>)}</td>
                    <td className="px-2 py-1.5"><input form={fid} name="studentsPerShift" type="number" defaultValue={u?.studentsPerShift ?? 0} className="w-12 rounded border border-slate-300 px-1.5 py-1 text-right" /></td>
                    <td className="px-2 py-1.5"><input form={fid} name="studentsPerPreceptor" type="number" defaultValue={u?.studentsPerPreceptor ?? 1} className="w-12 rounded border border-slate-300 px-1.5 py-1 text-right" /></td>
                    <td className="px-2 py-1.5"><input form={fid} name="preceptorsPerShift" type="number" defaultValue={u?.preceptorsPerShift ?? 0} className="w-12 rounded border border-slate-300 px-1.5 py-1 text-right" /></td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{isNew ? "—" : u.studentsPerShift * blocks.length * days.length}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {isNew ? <form id={fid} action={createClinicalUnit.bind(null, e.id)}><button className="rounded bg-rose-600 px-2 py-1 font-medium text-white hover:bg-rose-700">+ Add</button></form> : (
                        <span className="inline-flex items-center gap-1"><form id={fid} action={updateClinicalUnit.bind(null, u.id, e.id)}><input type="hidden" name="status" value={u.status} /><button className="rounded bg-slate-800 px-2 py-1 font-medium text-white hover:bg-slate-700">Save</button></form><form action={deleteClinicalUnit.bind(null, u.id, e.id)}><button className="rounded px-1.5 py-1 text-slate-300 hover:text-rose-600" title="delete unit">✕</button></form></span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Collapse>

      {/* 7 · Sections & placements */}
      <Collapse title="Booked here" sub="Clinical sections on the calendar at this site, and the students placed here" summary={<>{e.meetings.length} section{e.meetings.length === 1 ? "" : "s"} · {e.placements.length} placement{e.placements.length === 1 ? "" : "s"} · {secured} secured</>}>
        <div className="space-y-4">
          {e.meetings.length === 0 ? <p className="text-sm text-slate-400">No clinical section is booked here yet.</p> : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Offering</th><th className="px-3 py-2 font-semibold">Course · section</th><th className="px-3 py-2 font-semibold">When</th><th className="px-3 py-2 font-semibold">Unit</th><th className="px-3 py-2 text-right font-semibold">Seats</th><th className="px-3 py-2 font-semibold">Preceptor</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {e.meetings.map((m) => (
                    <tr key={m.id}>
                      <td className="px-3 py-1.5"><Link href={`/programs/${m.cohort.programId}/offerings/${m.cohort.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{m.cohort.name}</Link><span className="block text-slate-400">{m.cohort.program.name}</span></td>
                      <td className="px-3 py-1.5">{m.course.code ?? m.course.name} §{m.sectionIndex}/{m.sectionCount}</td>
                      <td className="px-3 py-1.5 tabular-nums">{m.dayOfWeek} {m.startTime} · {m.lengthHours}h</td>
                      <td className="px-3 py-1.5">{m.unit?.unitType ?? <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{m.seats}</td>
                      <td className={`px-3 py-1.5 ${m.staff?.name ? "" : "text-amber-600"}`}>{m.staff?.name ?? "unassigned"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {e.placements.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Student</th><th className="px-3 py-2 font-semibold">Cohort · term</th><th className="px-3 py-2 font-semibold">Window</th><th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2 text-right font-semibold"></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {e.placements.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-1.5"><Link href={`/students/${p.student.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{p.student.name}</Link><span className="block text-slate-400">{p.student.program.name}</span></td>
                      <td className="px-3 py-1.5 text-slate-500">{[p.cohort?.name, p.term?.name].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-3 py-1.5 text-slate-500">{p.startDate || p.endDate ? `${dateFmt(p.startDate)} → ${dateFmt(p.endDate)}` : "—"}{p.modality ? ` · ${p.modality}` : ""}</td>
                      <td className="px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PSTATUS_BADGE[p.status] ?? "bg-slate-100 text-slate-600"}`}>{p.status}</span></td>
                      <td className="px-3 py-1.5"><div className="flex items-center justify-end gap-1">{(PLACEMENT_NEXT[p.status] ?? []).map((s) => <form key={s} action={updatePlacementStatus.bind(null, p.id, s)}><button className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50">→ {s}</button></form>)}<form action={deletePlacement.bind(null, p.id)}><button className="rounded px-1.5 py-0.5 text-[11px] text-slate-300 hover:text-rose-600" title="remove placement">✕</button></form></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Collapse>
    </div>
  );
}

function Field({ name, label, defaultValue, type = "text", required }: { name: string; label: string; defaultValue?: string | null; type?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className={lbl}>{label}</span>
      <input name={name} type={type} required={required} defaultValue={defaultValue ?? ""} className={inp} />
    </label>
  );
}
