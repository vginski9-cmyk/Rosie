import Link from "next/link";
import { getSiteRegistry } from "@/lib/queries";
import { addSiteAsPartner, createRegistrySite } from "@/lib/actions";
import { fmt } from "@/lib/format";
import { DRIVE_BAND_TONE } from "@/lib/geo";

export const dynamic = "force-dynamic";

// THE SITE REGISTRY — every clinical site in the world the platform knows, once, whichever colleges
// approach it. A college's relationship with a site (approached, asked, secured; its drive time; the
// assets it may use) is that college's own partner record, linked here. Several colleges can court
// the same hospital and see each other doing it.

const AGREE_TONE: Record<string, string> = { secured: "bg-emerald-100 text-emerald-800", asked: "bg-sky-100 text-sky-800", prospect: "bg-slate-100 text-slate-600", none: "bg-slate-100 text-slate-500", declined: "bg-rose-100 text-rose-800" };
const FACILITY_TYPES = ["Acute care hospital", "Specialty hospital", "Ambulatory surgery center", "Nursing home", "Combination home (NH + adult care)", "Adult care home", "Physician office / clinic", "Imaging center", "Behavioral health facility", "Home health / hospice", "Public health / community", "Other"];
const short = (name: string) => name.replace(/ Community College$/, "");
const inp = "w-full rounded border border-slate-300 px-2 py-1 text-xs";
const lbl = "block text-[10px] font-semibold uppercase tracking-wide text-slate-500";

export default async function SiteRegistryPage({ searchParams }: { searchParams: { q?: string; inst?: string; only?: string } }) {
  const { sites, institutions } = await getSiteRegistry();
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const inst = searchParams.inst ?? "";
  const only = searchParams.only ?? ""; // "" | "partner" | "open"
  const rows = sites.filter((s) => {
    if (q && !`${s.name} ${s.organization ?? ""} ${s.city ?? ""} ${s.county ?? ""} ${s.facilityType ?? ""}`.toLowerCase().includes(q)) return false;
    if (inst && only === "partner" && !s.partners.some((p) => p.institutionId === inst)) return false;
    if (inst && only === "open" && s.partners.some((p) => p.institutionId === inst)) return false;
    return true;
  });
  const shared = sites.filter((s) => new Set(s.partners.map((p) => p.institutionId)).size > 1).length;
  const unclaimed = sites.filter((s) => s.partners.length === 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Site registry</h1>
          <p className="text-sm text-slate-500">{fmt.num(sites.length)} clinical sites, one record each, whichever colleges approach them · {fmt.num(shared)} courted by more than one college · {fmt.num(unclaimed)} nobody&apos;s partner yet. A college&apos;s own agreement, contacts, drive time and assets live on its partner record; open a college&apos;s chip to see it.</p>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs">
        <label className="block min-w-[14rem] flex-1"><span className={lbl}>Search</span><input name="q" defaultValue={searchParams.q ?? ""} placeholder="name, system, city, county, type" className={inp} /></label>
        <label className="block"><span className={lbl}>College</span><select name="inst" defaultValue={inst} className={inp}><option value="">any</option>{institutions.map((i) => <option key={i.id} value={i.id}>{short(i.name)}</option>)}</select></label>
        <label className="block"><span className={lbl}>Show</span><select name="only" defaultValue={only} className={inp}><option value="">every site</option><option value="partner">its partners</option><option value="open">not yet its partner</option></select></label>
        <button className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">Filter</button>
        {(q || inst || only) && <Link href="/sites" className="text-slate-500 hover:text-rose-600">clear</Link>}
      </form>

      <div className="max-h-[42rem] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 text-left">Site</th><th className="px-2 py-2 text-left">Type · county</th><th className="px-2 py-2 text-left">Colleges courting it — agreement · drive from that campus · assets · seats a shift</th><th className="px-2 py-2 text-left">Add as a partner of…</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((s) => {
              const partnered = new Set(s.partners.map((p) => p.institutionId));
              const open = institutions.filter((i) => !partnered.has(i.id));
              return (
                <tr key={s.id} className="hover:bg-slate-50/60 align-top">
                  <td className="px-3 py-1.5"><span className="font-medium text-slate-800">{s.name}</span><span className="block text-[10px] text-slate-400">{[s.organization, [s.address, s.city].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}{s.lat == null && <span className="text-amber-700"> · not located</span>}</span></td>
                  <td className="px-2 py-1.5 text-slate-600">{s.facilityType ?? "—"}{s.county ? <span className="block text-[10px] text-slate-400">{s.county}</span> : null}{s.licensedBeds != null || s.operatingRooms != null ? <span className="block text-[10px] text-slate-400">{[s.licensedBeds != null ? `${fmt.num(s.licensedBeds)} beds` : null, s.operatingRooms != null ? `${fmt.num(s.operatingRooms)} ORs` : null].filter(Boolean).join(" · ")}</span> : null}</td>
                  <td className="px-2 py-1.5">
                    {s.partners.length === 0 ? <span className="text-slate-300">no college yet</span> : (
                      <div className="flex flex-wrap gap-1">
                        {s.partners.map((p) => (
                          <Link key={p.id} href={`/employers/${p.id}`} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ring-black/5 hover:underline ${AGREE_TONE[p.agreementStatus] ?? "bg-slate-100 text-slate-600"}`} title={`${p.institution.name}: ${p.agreementStatus} · open its partner record`}>
                            <span className="font-medium">{short(p.institution.name)}</span><span>· {p.agreementStatus}</span>
                            {p.driveMinutes != null && <span className={`rounded px-1 ${DRIVE_BAND_TONE[p.ring ?? ""] ?? ""}`}>≈ {fmt.minutes(p.driveMinutes)}</span>}
                            <span className="text-slate-500">· {fmt.num(p.assets.length)} assets · {fmt.num(p.assets.reduce((n, a) => n + a.learnersPerShift, 0))} seats</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {open.length === 0 ? <span className="text-[10px] text-slate-400">every college has it</span> : (
                      <form action={addSiteAsPartner} className="flex items-center gap-1">
                        <input type="hidden" name="siteId" value={s.id} />
                        <select name="institutionId" className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px]" defaultValue={inst && open.some((i) => i.id === inst) ? inst : open[0].id}>{open.map((i) => <option key={i.id} value={i.id}>{short(i.name)}</option>)}</select>
                        <select name="agreementStatus" className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px]" defaultValue="prospect"><option value="prospect">prospect</option><option value="asked">asked</option><option value="secured">secured</option></select>
                        <button className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-indigo-700">add</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">No site matches.</td></tr>}
          </tbody>
        </table>
      </div>

      <details className="rounded-xl border border-dashed border-slate-300 bg-white">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-700">+ A site nobody has recorded yet</summary>
        <form action={createRegistrySite} className="grid gap-2 border-t border-slate-100 p-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <label className="block lg:col-span-2"><span className={lbl}>Site name</span><input name="name" required className={inp} /></label>
          <label className="block"><span className={lbl}>Organization / system</span><input name="organization" className={inp} /></label>
          <label className="block"><span className={lbl}>Facility type</span><select name="facilityType" className={inp}><option value="">—</option>{FACILITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label className="block lg:col-span-2"><span className={lbl}>Street address</span><input name="address" className={inp} /></label>
          <label className="block"><span className={lbl}>City</span><input name="city" className={inp} /></label>
          <label className="block"><span className={lbl}>ZIP</span><input name="zip" className={inp} /></label>
          <label className="block"><span className={lbl}>County</span><input name="county" className={inp} /></label>
          <label className="block"><span className={lbl}>Also make it a partner of</span><select name="institutionId" className={inp}><option value="">— nobody yet —</option>{institutions.map((i) => <option key={i.id} value={i.id}>{short(i.name)}</option>)}</select></label>
          <label className="block"><span className={lbl}>…with the agreement</span><select name="agreementStatus" className={inp}><option value="prospect">prospect</option><option value="asked">asked</option><option value="secured">secured</option></select></label>
          <div className="flex items-end"><button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Add to the registry</button></div>
        </form>
      </details>
    </div>
  );
}
