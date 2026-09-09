import { updateFamilyRotationPolicy } from "@/lib/actions";
import type { getFamilyClinicalRules } from "@/lib/queries";
import { dec } from "@/lib/format";

// HOW THIS JOB SCHEDULES CLINICALS — the family's own way of counting availability
// (seats, cases or staff) and its placement rules. Each site's agreed limits live on
// the site's own setup page. Set up once here; every offering's clinical schedule is
// built from it and never configured on the offering.

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
        <p className="text-[11px] text-slate-500 sm:col-span-2 lg:col-span-4">Every offering&apos;s clinical schedule is built from these rules and the availability below — the offering page only builds and pins, it never configures. Physical assets, shift structures, staff and what each site provides are set up per site under Sites below; the requirement grid (hours per service area per course) is on each program template&apos;s design page.</p>
      </form>

      <p className="text-[11px] text-slate-400">Each site&apos;s agreed limits for {f.name} — students at once{f.capacityBasis === "cases" ? ", daily cases" : f.capacityBasis === "staff" ? ", qualified staff on shift" : ""}, days and shift blocks — are set on that site&apos;s setup page (Sites below → Set up). Blank days / blocks mean the site takes students whenever its assets run; students-at-once stacks with any accreditor-approved capacity and the planner uses the lower.</p>
    </div>
  );
}
