import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployer } from "@/lib/queries";
import { updateEmployer, updatePlacementStatus, deletePlacement, createClinicalUnit, updateClinicalUnit, deleteClinicalUnit } from "@/lib/actions";
import { AssetBuilder } from "@/components/AssetBuilder";

const SETTING_PRESETS = [
  ["GEN", "General diagnostic radiography", "Fixed radiographic room"], ["ED", "Emergency / trauma radiography", "ED radiographic room"], ["PORT", "Portable / inpatient radiography", "Mobile radiography unit"],
  ["OR", "Operating room / C-arm", "Mobile C-arm"], ["FLUORO", "Diagnostic fluoroscopy", "R&F / fluoroscopy room"], ["CT", "Computed tomography", "CT scanner"], ["MRI", "Magnetic resonance", "MRI scanner"],
  ["ORS", "Operating room suite", "OR suite"], ["BEDS", "Inpatient nursing unit", "Bed unit"], ["LTC", "Long-term care unit", "SNF nursing unit"], ["AMB", "Ambulatory office", "Exam room"],
];

export const dynamic = "force-dynamic";

const EMP_STATUSES = ["prospect", "active", "paused", "archived"];
const PLACEMENT_NEXT: Record<string, string[]> = {
  planned: ["active", "cancelled"], active: ["completed", "cancelled"], completed: [], cancelled: ["planned"],
};
const PSTATUS_BADGE: Record<string, string> = {
  planned: "bg-sky-100 text-sky-700", active: "bg-emerald-100 text-emerald-700",
  completed: "bg-slate-200 text-slate-600", cancelled: "bg-slate-100 text-slate-400",
};
const dateFmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

export default async function EmployerPage({ params }: { params: { id: string } }) {
  const e = await getEmployer(params.id);
  if (!e) notFound();

  // WBL capacity is read from placement records, not a static slot count: "asked"
  // = every non-cancelled rotation directed here; "secured" = active + completed.
  const seasonOf = (d: Date) => { const m = d.getUTCMonth(); return m >= 7 ? "Fall" : m >= 5 ? "Summer" : "Spring"; };
  const live = e.placements.filter((p) => p.status !== "cancelled");
  const asked = live.length;
  const secured = e.placements.filter((p) => p.status === "active" || p.status === "completed").length;
  const fillRate = asked > 0 ? Math.round((secured / asked) * 100) : 0;
  const periodMap: Record<string, { year: number; season: string; asked: number; secured: number }> = {};
  for (const p of live) {
    if (!p.startDate) continue;
    const d = new Date(p.startDate);
    const key = `${d.getUTCFullYear()} ${seasonOf(d)}`;
    const b = periodMap[key] ?? { year: d.getUTCFullYear(), season: seasonOf(d), asked: 0, secured: 0 };
    b.asked += 1; if (p.status === "active" || p.status === "completed") b.secured += 1; periodMap[key] = b;
  }
  const periods = Object.values(periodMap).sort((a, b) => b.year - a.year || a.season.localeCompare(b.season));

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <Link href="/employers" className="text-sm text-slate-500 hover:text-slate-700">← Employer partners</Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{e.name}</h1>
            <p className="text-sm text-slate-500">
              {[e.setting, e.city, e.institution.name].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{e.status}</span>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${fillRate >= 90 ? "bg-emerald-100 text-emerald-700" : fillRate >= 70 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
              {secured} of {asked} rotations secured ({fillRate}%)
            </span>
          </div>
        </div>
      </div>

      {/* WBL capacity — sourced from placement records, by year & semester */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">WBL rotations — asked vs secured</h2>
        <p className="mt-0.5 text-xs text-slate-400">Read live from placement records — what programs asked this partner to host vs what was actually secured. No static slot count, because real availability shifts week to week.</p>
        {periods.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No dated rotations yet.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {periods.map((p) => {
              const gap = p.asked > p.secured;
              return (
                <div key={`${p.year}-${p.season}`} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="text-[11px] font-medium text-slate-500">{p.season} {p.year}</div>
                  <div className="mt-0.5 text-sm tabular-nums">
                    <span className={gap ? "font-semibold text-amber-600" : "text-emerald-600"}>{p.secured}</span>
                    <span className="text-slate-400"> / {p.asked} secured</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Contact + details (editable) */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Partner details</h2>
        <form action={updateEmployer.bind(null, e.id)} className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field name="name" label="Name" defaultValue={e.name} required />
          <Field name="setting" label="Setting" defaultValue={e.setting} />
          <Field name="city" label="City" defaultValue={e.city} />
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</span>
            <select name="status" defaultValue={e.status} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              {EMP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <Field name="contactName" label="Contact name" defaultValue={e.contactName} />
          <Field name="contactEmail" label="Contact email" type="email" defaultValue={e.contactEmail} />
          <Field name="contactPhone" label="Contact phone" defaultValue={e.contactPhone} />
          {/* ── Clinical asset map: facility level ── */}
          <div className="sm:col-span-2 lg:col-span-4 mt-2 border-t border-slate-100 pt-3 text-[10px] font-semibold uppercase tracking-wide text-rose-500">Clinical asset map — facility</div>
          <Field name="organization" label="Organization / licensee" defaultValue={e.organization} />
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Facility type</span>
            <select name="facilityType" defaultValue={e.facilityType ?? ""} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              <option value="">—</option>
              {["Acute care hospital", "Specialty hospital", "Ambulatory surgery center", "Nursing home", "Combination home (NH + adult care)", "Adult care home", "Physician office / clinic", "Imaging center", "Behavioral health facility", "Home health / hospice", "Public health / community", "Other"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <Field name="county" label="County" defaultValue={e.county} />
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Ring (drive time)</span>
            <select name="ring" defaultValue={e.ring ?? ""} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              <option value="">—</option>{["Core", "Ring 1", "Ring 2", "Outside"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <Field name="licensedBeds" label="Licensed acute beds" type="number" defaultValue={e.licensedBeds != null ? String(e.licensedBeds) : ""} />
          <Field name="nursingHomeBeds" label="Nursing home beds" type="number" defaultValue={e.nursingHomeBeds != null ? String(e.nursingHomeBeds) : ""} />
          <Field name="adultCareBeds" label="Adult care beds" type="number" defaultValue={e.adultCareBeds != null ? String(e.adultCareBeds) : ""} />
          <Field name="operatingRooms" label="Operating rooms" type="number" defaultValue={e.operatingRooms != null ? String(e.operatingRooms) : ""} />
          <Field name="annualSurgicalCases" label="Annual surgical cases" type="number" defaultValue={e.annualSurgicalCases != null ? String(e.annualSurgicalCases) : ""} />
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Agreement with us</span>
            <select name="agreementStatus" defaultValue={e.agreementStatus} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium">
              {["none", "prospect", "asked", "secured", "declined"].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <Field name="agreementNotes" label="Agreement notes (who, when, terms)" defaultValue={e.agreementNotes} />
          <label className="block sm:col-span-2 lg:col-span-4">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Notes</span>
            <textarea name="notes" defaultValue={e.notes ?? ""} rows={2} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
          <div className="lg:col-span-4">
            <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Save details</button>
          </div>
        </form>
      </section>

      {/* ── Functional units — the asset map's master grain ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Functional units <span className="text-sm font-normal text-slate-400">— where the capacity math happens</span></h2>
          <p className="text-sm text-slate-500">Each unit: what it is, how many beds / rooms / stations, which shift blocks it runs and on which days, and how many students and preceptors a shift takes. Weekly student slots = students per shift × shifts per day × days open.</p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-2 py-2 font-semibold">Unit type</th><th className="px-2 py-2 font-semibold">Category</th><th className="px-2 py-2 font-semibold">Capacity</th><th className="px-2 py-2 font-semibold">Source</th><th className="px-2 py-2 font-semibold">Shifts / day · hrs</th><th className="px-2 py-2 font-semibold">Blocks</th><th className="px-2 py-2 font-semibold">Days open</th><th className="px-2 py-2 font-semibold">Students / shift</th><th className="px-2 py-2 font-semibold">Students / preceptor</th><th className="px-2 py-2 font-semibold">Preceptors / shift</th><th className="px-2 py-2 text-right font-semibold">Weekly slots</th><th className="px-2 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...e.units, null].map((u, i) => {
                const isNew = u == null;
                const days = (u?.days ?? "Mon,Tue,Wed,Thu,Fri").split(",");
                const blocks = (u?.shiftBlocks ?? "Day").split(",");
                const weekly = u ? u.studentsPerShift * blocks.length * days.length : 0;
                const fid = isNew ? "unit-new" : `unit-${u.id}`;
                return (
                  <tr key={u?.id ?? "new"} className={isNew ? "bg-rose-50/30" : ""}>
                    <td className="px-2 py-1.5"><input form={fid} name="unitType" defaultValue={u?.unitType ?? ""} placeholder={isNew ? "new unit type" : ""} className="w-40 rounded border border-slate-300 px-1.5 py-1" /></td>
                    <td className="px-2 py-1.5">
                      <select form={fid} name="unitCategory" defaultValue={u?.unitCategory ?? "Inpatient beds"} className="rounded border border-slate-300 px-1.5 py-1">
                        {["Inpatient beds", "Surgical", "Emergency", "Imaging", "Laboratory", "Long-term care beds", "Adult care beds", "Behavioral health", "Ambulatory office", "Community"].map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap"><input form={fid} name="capacityCount" type="number" step="any" defaultValue={u?.capacityCount ?? ""} className="w-16 rounded border border-slate-300 px-1.5 py-1 text-right" /> <input form={fid} name="uom" defaultValue={u?.uom ?? "beds"} className="w-16 rounded border border-slate-300 px-1.5 py-1" /></td>
                    <td className="px-2 py-1.5"><select form={fid} name="dataSource" defaultValue={u?.dataSource ?? "ESTIMATE"} className="rounded border border-slate-300 px-1.5 py-1">{["VERIFIED", "ESTIMATE", "GAP"].map((d) => <option key={d} value={d}>{d}</option>)}</select></td>
                    <td className="px-2 py-1.5 whitespace-nowrap"><input form={fid} name="shiftsPerDay" type="number" defaultValue={u?.shiftsPerDay ?? 2} className="w-12 rounded border border-slate-300 px-1.5 py-1 text-right" /> × <input form={fid} name="shiftLengthHrs" type="number" step="any" defaultValue={u?.shiftLengthHrs ?? 12} className="w-14 rounded border border-slate-300 px-1.5 py-1 text-right" />h</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{["Day", "Evening", "Night"].map((b) => <label key={b} className="mr-1.5 inline-flex items-center gap-0.5"><input form={fid} type="checkbox" name={`block_${b}`} defaultChecked={blocks.includes(b)} />{b[0]}</label>)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <label key={d} className="mr-1 inline-flex items-center gap-0.5"><input form={fid} type="checkbox" name={`day_${d}`} defaultChecked={days.includes(d)} />{d[0]}</label>)}</td>
                    <td className="px-2 py-1.5"><input form={fid} name="studentsPerShift" type="number" defaultValue={u?.studentsPerShift ?? 0} className="w-14 rounded border border-slate-300 px-1.5 py-1 text-right" /></td>
                    <td className="px-2 py-1.5"><input form={fid} name="studentsPerPreceptor" type="number" defaultValue={u?.studentsPerPreceptor ?? 1} className="w-14 rounded border border-slate-300 px-1.5 py-1 text-right" /></td>
                    <td className="px-2 py-1.5"><input form={fid} name="preceptorsPerShift" type="number" defaultValue={u?.preceptorsPerShift ?? 0} className="w-14 rounded border border-slate-300 px-1.5 py-1 text-right" /></td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{isNew ? "—" : weekly}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {isNew ? (
                        <form id={fid} action={createClinicalUnit.bind(null, e.id)}><button className="rounded bg-rose-600 px-2 py-1 font-medium text-white hover:bg-rose-700">+ Add unit</button></form>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <form id={fid} action={updateClinicalUnit.bind(null, u.id, e.id)}><input type="hidden" name="status" value={u.status} /><button className="rounded bg-slate-800 px-2 py-1 font-medium text-white hover:bg-slate-700">Save</button></form>
                          <form action={deleteClinicalUnit.bind(null, u.id, e.id)}><button className="rounded px-1.5 py-1 text-slate-300 hover:text-rose-600" title="delete unit">✕</button></form>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Physical assets — the 365-day asset map's grain ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Physical assets <span className="text-sm font-normal text-slate-400">— one card per room, unit or machine, with its shift structure</span></h2>
            <p className="text-sm text-slate-500">What it is, which days it runs, which shifts and how long each one is, and how many learners a shift takes. Every day of the year follows the structure unless a closure says otherwise.</p>
          </div>
          <a href={`/api/asset-map?institutionId=${e.institutionId}&employerId=${e.id}&year=${new Date().getUTCFullYear() + 1}`} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Download this site&apos;s workbook</a>
        </div>
        <AssetBuilder
          employerId={e.id} siteName={e.name} siteExternalId={e.externalId} year={new Date().getUTCFullYear() + 1}
          assets={e.assets.map((a) => ({ id: a.id, externalId: a.externalId, employerId: a.employerId, facilityName: e.name, facilityExternalId: e.externalId, county: e.county, ring: e.ring, facilityType: e.facilityType, agreementStatus: e.agreementStatus, facilityStatus: e.status, settingCode: a.settingCode, setting: a.setting, assetType: a.assetType, assetNumber: a.assetNumber, operatingRule: a.operatingRule, days: a.days, shiftBlocks: a.shiftBlocks, hoursPerShift: a.hoursPerShift, dayStart: a.dayStart, dayHours: a.dayHours, eveningStart: a.eveningStart, eveningHours: a.eveningHours, nightStart: a.nightStart, nightHours: a.nightHours, serves: a.serves, learnersPerShift: a.learnersPerShift, preceptorsPerShift: a.preceptorsPerShift, dataSource: a.dataSource, status: a.status, notes: a.notes, exceptions: a._count.dayOverrides }))}
          overrides={e.assetOverrides}
          settings={SETTING_PRESETS.map(([code, name, assetType]) => ({ code, name, assetType }))}
        />
      </section>

      {/* ── Sections hosted here ── */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Clinical sections hosted here <span className="text-sm font-normal text-slate-400">— weekly bookings assigned to this site</span></h2>
        {e.meetings.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">Nothing assigned yet — assign sections under Insights → Clinical sites → Assign sections.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Offering</th><th className="px-3 py-2 font-semibold">Course · section</th><th className="px-3 py-2 font-semibold">When</th><th className="px-3 py-2 font-semibold">Unit</th><th className="px-3 py-2 text-right font-semibold">Seats</th><th className="px-3 py-2 font-semibold">Preceptor</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {e.meetings.map((m) => (
                  <tr key={m.id}>
                    <td className="px-3 py-1.5"><Link href={`/programs/${m.cohort.programId}/offerings/${m.cohort.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{m.cohort.name}</Link><span className="block text-slate-400">{m.cohort.program.name}</span></td>
                    <td className="px-3 py-1.5">{m.course.code ?? m.course.name} §{m.sectionIndex}/{m.sectionCount}</td>
                    <td className="px-3 py-1.5 tabular-nums">{m.dayOfWeek} {m.startTime} · {m.lengthHours}h</td>
                    <td className="px-3 py-1.5">{m.unit?.unitType ?? <span className="text-amber-600">unit not set</span>}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m.seats}</td>
                    <td className={`px-3 py-1.5 ${m.staff?.name ? "" : "text-amber-600"}`}>{m.staff?.name ?? "unassigned"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Partner alignment intake */}
      <Link href={`/employers/${e.id}/alignment`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 hover:border-rose-200 hover:bg-rose-50/40">
        <div>
          <div className="text-sm font-semibold text-slate-800">Partner alignment intake ↦</div>
          <div className="text-xs text-slate-500">what this partner actually wants from hosting · hosting constraints · real capacities → hostable WBL modes</div>
        </div>
        <span className="text-rose-600">→</span>
      </Link>

      {/* Placements hosted here */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Placements <span className="text-sm font-normal text-slate-400">— students hosted here</span></h2>
          <span className="text-xs text-slate-400">{e.placements.length} total · {secured} secured</span>
        </div>
        {e.placements.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No placements yet. Assign a student from their profile&apos;s WBL placement section.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 text-left font-semibold">Student</th>
                  <th className="px-3 py-2 text-left font-semibold">Cohort / term</th>
                  <th className="px-3 py-2 text-left font-semibold">Window</th>
                  <th className="px-3 py-2 text-left font-semibold">Modality</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {e.placements.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <Link href={`/students/${p.student.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{p.student.name}</Link>
                      <span className="block text-[11px] text-slate-400">{p.student.program.name}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{[p.cohort?.name, p.term?.name].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 text-slate-500">{p.startDate || p.endDate ? `${dateFmt(p.startDate)} → ${dateFmt(p.endDate)}` : "—"}{p.hoursPerWeek ? ` · ${p.hoursPerWeek}h/wk` : ""}</td>
                    <td className="px-3 py-2 text-slate-500">{p.modality ?? "—"}</td>
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PSTATUS_BADGE[p.status] ?? "bg-slate-100 text-slate-600"}`}>{p.status}</span></td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {(PLACEMENT_NEXT[p.status] ?? []).map((s) => (
                          <form key={s} action={updatePlacementStatus.bind(null, p.id, s)}>
                            <button className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50">→ {s}</button>
                          </form>
                        ))}
                        <form action={deletePlacement.bind(null, p.id)}>
                          <button className="rounded px-1.5 py-0.5 text-[11px] text-slate-300 hover:text-rose-600" title="remove placement">✕</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ name, label, defaultValue, type = "text", required }: { name: string; label: string; defaultValue?: string | null; type?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <input name={name} type={type} required={required} defaultValue={defaultValue ?? ""} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
    </label>
  );
}
