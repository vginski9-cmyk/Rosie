import Link from "next/link";
import type { getFamilyClinicalSetup } from "@/lib/queries";
import { addSiteToProgram } from "@/lib/actions";
import { dec } from "@/lib/format";

// THE SITES THAT SERVE ONE PROGRAM — one row each, with its setup state and what it
// contributes to completion, and the form that adds a site to this program (an
// organization already in the directory, or a new one located from its address).
// Every row opens the site's setup page inside this program. Server component.

type Setup = NonNullable<Awaited<ReturnType<typeof getFamilyClinicalSetup>>>;
const AGREEMENT: Record<string, string> = { none: "bg-slate-100 text-slate-500", prospect: "bg-sky-100 text-sky-700", asked: "bg-amber-100 text-amber-700", secured: "bg-emerald-100 text-emerald-700", declined: "bg-rose-100 text-rose-700" };
const RING: Record<string, string> = { Core: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200", "Ring 1": "bg-sky-50 text-sky-800 ring-1 ring-sky-200", "Ring 2": "bg-amber-50 text-amber-800 ring-1 ring-amber-200", "Ring 3": "bg-rose-50 text-rose-800 ring-1 ring-rose-200" };
const FACILITY_TYPES = ["Acute care hospital", "Specialty hospital", "Ambulatory surgery center", "Imaging center", "Physician office / clinic", "Nursing home", "Combination home (NH + adult care)", "Adult care home", "Community health", "Other"];
const inp = "w-full rounded border border-slate-300 px-2 py-1 text-xs";
const lbl = "block text-[10px] font-semibold uppercase tracking-wide text-slate-500";

export function FamilySitesTable({ setup }: { setup: Setup }) {
  const fam = setup.family;
  const inFamily = setup.sites.filter((s) => s.inFamily);
  const candidates = setup.sites.filter((s) => !s.inFamily);
  const Row = ({ s }: { s: Setup["sites"][number] }) => {
    const href = `/families/${fam.id}/clinical/sites/${s.employerId}`;
    const pct = s.fit.required ? s.fit.requiredProvided / s.fit.required : 0;
    return (
      <tr className="hover:bg-slate-50/60">
        <td className="px-3 py-2 align-top">
          <Link href={href} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{s.name}</Link>
          <span className="block text-[11px] text-slate-500">{[s.facilityType, s.city].filter(Boolean).join(" · ")}</span>
        </td>
        <td className="px-2 py-2 align-top whitespace-nowrap">{s.ring ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${RING[s.ring] ?? "bg-slate-100"}`}>{s.ring}</span> : <span className="text-[10px] text-amber-600">not located</span>}{s.driveMinutes != null && <span className="ml-1 text-[10px] tabular-nums text-slate-500">≈ {Math.round(s.driveMinutes)} min</span>}</td>
        <td className="px-2 py-2 align-top"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${AGREEMENT[s.agreementStatus] ?? ""}`}>{s.agreementStatus}</span>{fam.accreditor && <span className={`block text-[10px] ${s.accreditorStatus === "recognized" ? "text-emerald-700" : s.accreditorStatus === "requested" ? "text-amber-700" : "text-slate-400"}`}>{fam.accreditor}: {s.accreditorStatus}{s.approvedCapacity != null ? ` · ${s.approvedCapacity} at once` : ""}</span>}</td>
        <td className="px-2 py-2 align-top text-slate-700">{s.assets ? <>{s.assets} asset{s.assets === 1 ? "" : "s"} · <span className="tabular-nums">{s.seats}</span> seats<span className="block text-[10px] text-slate-400">{Object.entries(s.seatsBySetting).map(([k, v]) => `${k} ${v}`).join(" · ")}</span>{s.assetsUnverified > 0 && <span className="block text-[10px] text-amber-600">{s.assetsUnverified} unverified</span>}</> : <span className="text-amber-600">no assets in {fam.name}&apos;s settings</span>}</td>
        <td className="px-2 py-2 align-top text-slate-700"><span className="tabular-nums">{s.preceptors}</span> {setup.discipline.label}{s.preceptors === 1 ? "" : "s"}{s.qualifiedStaffOnShift != null && <span className="block text-[10px] text-slate-400">{s.qualifiedStaffOnShift} qualified on shift</span>}{s.preceptors === 0 && <span className="block text-[10px] text-amber-600">no preceptor on record</span>}</td>
        <td className="px-2 py-2 align-top whitespace-nowrap text-slate-600">{s.studentsAtOnce != null ? `${s.studentsAtOnce} at once` : s.approvedCapacity != null ? <span>{s.approvedCapacity} at once <span className="text-[10px] text-slate-400">({fam.accreditor} approved)</span></span> : <span className="text-slate-400">no cap set</span>}{fam.capacityBasis === "cases" && s.casesPerDay != null && <span className="block text-[10px] text-slate-400">≈ {dec(s.casesPerDay, 1)} cases/day</span>}{(s.daysAllowed || s.blocksAllowed) && <span className="block text-[10px] text-slate-400">{[s.daysAllowed, s.blocksAllowed].filter(Boolean).join(" · ")}</span>}</td>
        <td className="px-2 py-2 align-top">
          {s.fit.required > 0 ? <>
            <div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded bg-slate-100"><div className={`h-full ${pct >= 1 ? "bg-emerald-500" : pct >= 0.5 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${Math.round(pct * 100)}%` }} /></div><span className="tabular-nums text-slate-700">{s.fit.requiredProvided} / {s.fit.required}</span></div>
            <span className="block text-[10px] text-slate-400">{s.fit.electiveProvided} / {s.fit.elective} electives{s.fit.unverified > 0 ? ` · ${s.fit.unverified} unconfirmed` : ""}{s.fit.declined > 0 ? ` · ${s.fit.declined} ruled out` : ""}</span>
          </> : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-2 py-2 align-top whitespace-nowrap text-slate-600">{s.sections ? <>{s.sections} section{s.sections === 1 ? "" : "s"} · {s.students} students</> : <span className="text-slate-300">—</span>}</td>
        <td className="px-2 py-2 align-top whitespace-nowrap">
          <Link href={href} className="rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-700">Set up →</Link>
          <span className={`block pt-1 text-[10px] ${s.setupDone === s.setupSteps ? "text-emerald-700" : "text-slate-400"}`}>{s.setupDone} of {s.setupSteps} steps done</span>
        </td>
      </tr>
    );
  };
  const Head = () => (
    <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
      <tr><th className="px-3 py-1.5 text-left">Site</th><th className="px-2 py-1.5 text-left">Ring · drive</th><th className="px-2 py-1.5 text-left">Agreement{fam.accreditor ? ` · ${fam.accreditor}` : ""}</th><th className="px-2 py-1.5 text-left">Assets in {fam.name}&apos;s settings</th><th className="px-2 py-1.5 text-left">Qualified staff</th><th className="px-2 py-1.5 text-left">Agreed availability</th><th className="px-2 py-1.5 text-left">Required experiences provided</th><th className="px-2 py-1.5 text-left">Hosting now</th><th className="px-2 py-1.5"></th></tr>
    </thead>
  );
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <Head />
          <tbody className="divide-y divide-slate-100">
            {inFamily.map((s) => <Row key={s.employerId} s={s} />)}
            {inFamily.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">No site is in {fam.name}&apos;s clinical setup yet — add one below.</td></tr>}
          </tbody>
        </table>
      </div>

      {candidates.length > 0 && (
        <details className="rounded-lg border border-dashed border-slate-300 bg-slate-50/40 p-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-700">{candidates.length} more organization{candidates.length === 1 ? " has" : "s have"} assets in {fam.name}&apos;s settings but no agreement with this program — open one to bring it in ▸</summary>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="w-full text-xs"><Head /><tbody className="divide-y divide-slate-100">{candidates.map((s) => <Row key={s.employerId} s={s} />)}</tbody></table></div>
        </details>
      )}

      <form action={addSiteToProgram.bind(null, fam.id)} className="grid gap-2 rounded-xl border border-rose-200 bg-rose-50/30 p-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-4"><div className="text-sm font-semibold text-slate-800">Add a site to {fam.name}&apos;s clinical setup</div><p className="text-[11px] text-slate-500">Pick an organization already in the directory, or create one — it is located from its address at once (drive time and ring), then you set up its assets, staff, availability and what it provides, on the next page.</p></div>
        <label className="block sm:col-span-2 lg:col-span-4"><span className={lbl}>An organization already in the directory</span>
          <select name="employerId" defaultValue="" className={inp}><option value="">— or create a new site below —</option>{setup.others.map((o) => <option key={o.id} value={o.id}>{o.name}{o.city ? ` · ${o.city}` : ""}{o.facilityType ? ` · ${o.facilityType}` : ""}{o.ring ? ` · ${o.ring}` : ""}</option>)}</select></label>
        <label className="block"><span className={lbl}>New site name</span><input name="name" placeholder="FirstHealth Montgomery Memorial" className={inp} /></label>
        <label className="block"><span className={lbl}>Organization / system</span><input name="organization" className={inp} /></label>
        <label className="block"><span className={lbl}>Facility type</span><select name="facilityType" className={inp}>{FACILITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label className="block"><span className={lbl}>County</span><input name="county" className={inp} /></label>
        <label className="block sm:col-span-2"><span className={lbl}>Street address</span><input name="address" placeholder="520 Allen St" className={inp} /></label>
        <label className="block"><span className={lbl}>City</span><input name="city" placeholder="Troy" className={inp} /></label>
        <label className="block"><span className={lbl}>State · ZIP</span><div className="flex gap-1"><input name="state" defaultValue="NC" className="w-12 rounded border border-slate-300 px-2 py-1 text-xs" /><input name="zip" placeholder="27371" className={inp} /></div></label>
        <label className="block"><span className={lbl}>Agreement for {fam.name}</span><select name="agreementStatus" defaultValue="prospect" className={inp}>{["none", "prospect", "asked", "secured", "declined"].map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
        <label className="block"><span className={lbl}>Contact name</span><input name="contactName" className={inp} /></label>
        <label className="block"><span className={lbl}>Contact email</span><input name="contactEmail" type="email" className={inp} /></label>
        <div className="flex items-end"><button className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-rose-700">Add site &amp; set it up →</button></div>
      </form>
    </div>
  );
}
