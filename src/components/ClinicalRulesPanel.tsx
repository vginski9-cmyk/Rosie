import { updateFamilyRotationPolicy, updateSiteAvailability } from "@/lib/actions";
import type { getFamilyClinicalRules } from "@/lib/queries";
import { dec } from "@/lib/format";

// HOW THIS JOB SCHEDULES CLINICALS — the family's own way of counting availability
// (seats, cases or staff), its placement rules, and what every site makes available
// to it (students at once, daily cases, days, shift blocks). Set up once here; every
// offering's clinical schedule is built from it and never configured on the offering.

type Rules = NonNullable<Awaited<ReturnType<typeof getFamilyClinicalRules>>>;
const inp = "rounded border border-slate-300 px-1.5 py-0.5 text-xs";
const lbl = "block text-[9px] font-semibold uppercase tracking-wide text-slate-500";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BLOCKS = ["Day", "Evening", "Night"];
const AGREEMENT_BADGE: Record<string, string> = { none: "bg-slate-100 text-slate-500", prospect: "bg-sky-100 text-sky-700", asked: "bg-amber-100 text-amber-700", secured: "bg-emerald-100 text-emerald-700", declined: "bg-rose-100 text-rose-700" };

export function ClinicalRulesPanel({ rules }: { rules: Rules }) {
  const f = rules.family;
  const csv = (v: string | null) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <div className="space-y-4">
      <form action={updateFamilyRotationPolicy.bind(null, f.id)} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <label className="block"><span className={lbl}>Clinical model</span><select name="clinicalModel" defaultValue={f.clinicalModel} className={inp + " w-full"}><option value="hours">hours-based (set hours in set settings)</option><option value="competency">competency / case-based</option><option value="mixed">hours + competencies</option></select></label>
        <label className="block" title="seats: learners per shift per room / unit (radiography). cases: a site's daily case volume ÷ the cases one student needs a day (surgical technology). staff: qualified staff on shift × students each may supervise (nurse aide, nursing)."><span className={lbl}>Availability is counted by</span><select name="capacityBasis" defaultValue={f.capacityBasis} className={inp + " w-full"}><option value="seats">seats — learners per shift per room / unit</option><option value="cases">cases — daily case volume ÷ cases per student-day</option><option value="staff">staff — qualified staff on shift × students per staff</option></select></label>
        <label className="block"><span className={lbl}>Cases one student needs per day</span><input name="casesPerStudentDay" type="number" step="any" min="0" defaultValue={f.casesPerStudentDay ?? ""} placeholder="case basis only" className={inp + " w-full"} /></label>
        <label className="block"><span className={lbl}>Case days a year (annual volume ÷)</span><input name="caseDaysPerYear" type="number" step="1" min="1" defaultValue={f.caseDaysPerYear ?? ""} placeholder="250" className={inp + " w-full"} /></label>
        <label className="block"><span className={lbl}>Students per qualified staff member</span><input name="studentsPerStaff" type="number" step="any" min="0" defaultValue={f.studentsPerStaff ?? ""} placeholder="staff basis only" className={inp + " w-full"} /></label>
        <label className="block"><span className={lbl}>Primary experience setting</span><select name="rotationPrimarySetting" defaultValue={f.rotationPrimarySetting ?? ""} className={inp + " w-full"}><option value="">auto — the most-required service area</option>{rules.settings.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        <label className="block"><span className={lbl}>Sites that may host</span><select name="rotationAgreements" defaultValue={f.rotationAgreements} className={inp + " w-full"}><option value="secured">secured agreements only</option><option value="secured+asked">secured + asked</option><option value="any">any site with the setting</option></select></label>
        <div className="flex flex-col justify-end gap-1">
          <label className="flex items-center gap-1"><input name="rotationKeepHome" type="checkbox" defaultChecked={f.rotationKeepHome} /> stay at the home site when it has the setting</label>
          <label className="flex items-center gap-1"><input name="rotationSkipHolidays" type="checkbox" defaultChecked={f.rotationSkipHolidays} /> leave holiday shifts open</label>
        </div>
        <label className="block sm:col-span-2 lg:col-span-3"><span className={lbl}>This program&apos;s clinical quirks (in words — shown to whoever builds a schedule)</span><input name="rotationNotes" defaultValue={f.rotationNotes ?? ""} placeholder="e.g. first-scrub case counts drive OR days; students rotate out in two-week blocks; no evenings in term 1" className={inp + " w-full"} /></label>
        <div className="flex items-end"><button className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700">Save rules</button></div>
        <p className="text-[11px] text-slate-500 sm:col-span-2 lg:col-span-4">Every offering&apos;s clinical schedule is built from these rules and the availability below — the offering page only builds and pins, it never configures. Physical assets (rooms, units, machines and their shifts) live in the supply map further down; the requirement grid (hours per service area per course) is on the family&apos;s structure page.</p>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-1.5 text-left">Site · agreement</th><th className="px-2 py-1.5 text-left">Seats by setting (from assets)</th><th className="px-2 py-1.5 text-right" title="The most students the site takes for this program at any one time (its agreement)">Students at once</th>{f.capacityBasis === "cases" && <th className="px-2 py-1.5 text-right" title="The site's daily case volume for this program's cases; blank = annual surgical cases ÷ case days">Cases / day</th>}{f.capacityBasis === "staff" && <th className="px-2 py-1.5 text-right">Staff on shift</th>}<th className="px-2 py-1.5 text-left">Days students may attend</th><th className="px-2 py-1.5 text-left">Shift blocks</th><th className="px-2 py-1.5 text-left">Notes</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rules.sites.map((s) => {
              const days = csv(s.daysAllowed), blocks = csv(s.blocksAllowed);
              const impliedCases = s.casesPerDay ?? (s.annualSurgicalCases != null ? s.annualSurgicalCases / Math.max(1, f.caseDaysPerYear ?? 250) : null);
              return (
                <tr key={s.employerId}>
                  <td className="px-3 py-1.5"><span className="font-medium text-slate-800">{s.name}</span><span className="block text-[10px] text-slate-400">{s.facilityType} · <span className={`rounded-full px-1.5 ${AGREEMENT_BADGE[s.agreementStatus] ?? ""}`}>{s.agreementStatus}</span>{s.accreditorStatus === "recognized" && s.approvedCapacity != null ? ` · ${f.accreditor ?? "accreditor"} approved ${s.approvedCapacity} at once` : ""}</span></td>
                  <td className="px-2 py-1.5 text-slate-600">{Object.entries(s.seatsBySetting).map(([k, v]) => `${k} ${v}`).join(" · ") || <span className="text-amber-600">no assets in this family&apos;s settings</span>}<span className="block text-[10px] text-slate-400">assets run {s.assetDays.join(", ") || "—"} · {s.assetBlocks.join(", ") || "—"}</span></td>
                  <td colSpan={f.capacityBasis === "seats" ? 5 : 6} className="px-2 py-1.5">
                    <form action={updateSiteAvailability.bind(null, f.id, s.employerId)} className="flex flex-wrap items-center gap-2">
                      <input name="studentsAtOnce" type="number" min="0" step="1" defaultValue={s.studentsAtOnce ?? ""} placeholder={s.approvedCapacity != null ? String(s.approvedCapacity) : "no cap"} className={inp + " w-16"} title="students at any one time" />
                      {f.capacityBasis === "cases" && <input name="casesPerDay" type="number" min="0" step="any" defaultValue={s.casesPerDay ?? ""} placeholder={impliedCases != null ? `~${dec(impliedCases)}` : "cases / day"} className={inp + " w-20"} title="daily case volume for this program" />}
                      {f.capacityBasis === "staff" && <span className="tabular-nums text-slate-600" title="qualified staff on shift — set on the accreditor / capacity card">{s.qualifiedStaffOnShift ?? <span className="text-amber-600">staff count missing</span>}</span>}
                      <span className="flex items-center gap-1">{DAYS.map((d) => <label key={d} className={`rounded px-1 ${days.includes(d) ? "bg-emerald-50 text-emerald-700" : "text-slate-500"}`} title={days.length === 0 ? "blank = every day the assets run" : ""}><input name={`day_${d}`} type="checkbox" defaultChecked={days.includes(d)} className="mr-0.5 align-middle" />{d}</label>)}</span>
                      <span className="flex items-center gap-1">{BLOCKS.map((b) => <label key={b} className={`rounded px-1 ${blocks.includes(b) ? "bg-emerald-50 text-emerald-700" : "text-slate-500"}`}><input name={`block_${b}`} type="checkbox" defaultChecked={blocks.includes(b)} className="mr-0.5 align-middle" />{b}</label>)}</span>
                      <input name="availabilityNotes" defaultValue={s.availabilityNotes ?? ""} placeholder="notes (orientation dates, badge lead time, no students on call …)" className={inp + " min-w-[14rem] flex-1"} />
                      <button className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-white">Save</button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {rules.sites.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-400">No sites carry assets in this family&apos;s settings yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">Blank days / blocks mean the site takes students whenever its assets run. Students-at-once is the agreement&apos;s own cap and stacks with any accreditor-approved capacity; the planner uses the lower.</p>
    </div>
  );
}
