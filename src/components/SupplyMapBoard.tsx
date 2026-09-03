"use client";

// One job's clinical SUPPLY map — supply only, nothing about demand. The
// settings this job's clinicals happen in, every site that serves it (add one
// from the directory or brand new), each site's physical assets built one at a
// time with their shift structures, and what it all adds up to: shifts and
// hours per setting, per region, per site. Partner workbooks come in and go out.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assetTotals, parseAssetMapWorkbook, type AssetDayOverride, type ParsedAssetMap } from "@/lib/assetmap";
import { AssetBuilder, type BuilderAsset, type SettingOption } from "@/components/AssetBuilder";
import { upsertServiceArea, deleteServiceArea, upsertFamilySite, removeFamilySite, addFamilySite, importAssetMap } from "@/lib/actions";

const n0 = (v: number) => Math.round(v).toLocaleString();
const AGREEMENT: Record<string, string> = { none: "bg-slate-100 text-slate-500", prospect: "bg-sky-100 text-sky-700", asked: "bg-amber-100 text-amber-700", secured: "bg-emerald-100 text-emerald-700", declined: "bg-rose-100 text-rose-700" };
const AGREEMENTS = ["none", "prospect", "asked", "secured", "declined"];
const FACILITY_TYPES = ["Acute care hospital", "Specialty hospital", "Ambulatory surgery center", "Imaging center", "Physician office / clinic", "Nursing home", "Combination home (NH + adult care)", "Adult care home", "Community health", "Other"];

export interface SmFamily { id: string; name: string; institutionId: string; institution: string; occupation: string | null; soc: string | null }
export interface SmSetting { id: string; code: string; name: string; settingCodes: string; unitCategories: string; notes: string | null }
export interface SmSite { id: string; name: string; externalId: string | null; organization: string | null; county: string | null; ring: string | null; facilityType: string | null; address: string | null; city: string | null; state: string | null; zip: string | null; status: string; agreementStatus: string; contactName: string | null; contactEmail: string | null; notes: string | null; assets: BuilderAsset[] }
export interface SmOrg { id: string; name: string; county: string | null; ring: string | null; facilityType: string | null }

export function SupplyMapBoard({ family, settings, sites, overrides, organizations, year }: { family: SmFamily; settings: SmSetting[]; sites: SmSite[]; overrides: AssetDayOverride[]; organizations: SmOrg[]; year: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [addSite, setAddSite] = useState(false);
  const [yr, setYr] = useState(year);
  const refresh = () => router.refresh();
  const settingOptions: SettingOption[] = useMemo(() => settings.map((s) => ({ code: s.settingCodes.split(",")[0]?.trim() || s.code, name: s.name, assetType: sites.flatMap((x) => x.assets).find((a) => a.settingCode === (s.settingCodes.split(",")[0]?.trim() || s.code))?.assetType })), [settings, sites]);
  const allAssets = useMemo(() => sites.flatMap((s) => s.assets), [sites]);
  const totals = useMemo(() => assetTotals(allAssets, overrides, `${yr}-01-01`, `${yr}-12-31`), [allAssets, overrides, yr]);
  const byRegion = (key: "county" | "ring") => { const m = new Map<string, { sites: number; assets: number; shifts: number; hours: number }>(); for (const s of sites) { const k = s[key] ?? "—"; const t = assetTotals(s.assets, overrides, `${yr}-01-01`, `${yr}-12-31`).grand; const r = m.get(k) ?? { sites: 0, assets: 0, shifts: 0, hours: 0 }; r.sites++; r.assets += s.assets.length; r.shifts += t.total; r.hours += t.hours; m.set(k, r); } return [...m.entries()].sort((a, b) => b[1].hours - a[1].hours); };
  const secured = sites.filter((s) => s.agreementStatus === "secured").length;

  return (
    <div className="space-y-6">
      {/* ── What the supply adds up to ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-3xl text-base text-slate-800">
            <strong>{sites.length} sites</strong> serve {family.name} ({secured} secured for this job), holding <strong>{allAssets.length} physical assets</strong> across {totals.settings.length} setting{totals.settings.length === 1 ? "" : "s"}.
            {allAssets.length > 0 && <> In {yr} that is <strong>{n0(totals.grand.total)} shifts</strong> and <strong>{n0(totals.grand.hours)} asset-hours</strong>: {n0(totals.grand.day)} day, {n0(totals.grand.evening)} evening, {n0(totals.grand.night)} night shifts.</>}
            {allAssets.length === 0 && <> Add a site and build its assets below to map the supply.</>}
          </p>
          <label className="text-xs text-slate-600">Year <select value={yr} onChange={(e) => setYr(Number(e.target.value))} className="ml-1 rounded border border-slate-300 px-2 py-1">{[year - 1, year, year + 1, year + 2].map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        </div>
        {allAssets.length > 0 && (
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">By setting · {yr}</div>
              <table className="mt-1 w-full text-xs"><thead className="text-left text-[10px] uppercase tracking-wide text-slate-400"><tr><th className="py-1">Setting</th><th className="py-1 text-right">Assets</th><th className="py-1 text-right">Day</th><th className="py-1 text-right">Eve</th><th className="py-1 text-right">Night</th><th className="py-1 text-right">Shifts</th><th className="py-1 text-right">Hours</th></tr></thead>
                <tbody>{totals.settings.map((s) => <tr key={s.settingCode} className="border-t border-slate-100"><td className="py-1"><span className="font-mono text-[10px] text-slate-400">{s.settingCode}</span> {s.setting}</td><td className="py-1 text-right tabular-nums">{s.assets}</td><td className="py-1 text-right tabular-nums">{n0(s.day)}</td><td className="py-1 text-right tabular-nums">{n0(s.evening)}</td><td className="py-1 text-right tabular-nums">{n0(s.night)}</td><td className="py-1 text-right font-semibold tabular-nums">{n0(s.total)}</td><td className="py-1 text-right font-semibold tabular-nums">{n0(s.hours)}</td></tr>)}</tbody></table>
            </div>
            {(["county", "ring"] as const).map((k) => (
              <div key={k}>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">By {k} · {yr}</div>
                <table className="mt-1 w-full text-xs"><thead className="text-left text-[10px] uppercase tracking-wide text-slate-400"><tr><th className="py-1">{k}</th><th className="py-1 text-right">Sites</th><th className="py-1 text-right">Assets</th><th className="py-1 text-right">Shifts</th><th className="py-1 text-right">Hours</th></tr></thead>
                  <tbody>{byRegion(k).map(([key, v]) => <tr key={key} className="border-t border-slate-100"><td className="py-1 font-medium text-slate-700">{key}</td><td className="py-1 text-right tabular-nums">{v.sites}</td><td className="py-1 text-right tabular-nums">{v.assets}</td><td className="py-1 text-right tabular-nums">{n0(v.shifts)}</td><td className="py-1 text-right font-semibold tabular-nums">{n0(v.hours)}</td></tr>)}</tbody></table>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Settings this job's clinicals happen in ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Settings — where {family.name} clinicals happen</h2>
        <p className="text-sm text-slate-500">Every asset is tagged with one of these. Program design uses the same list to say which settings each course needs — that is how supply will later talk to demand.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {settings.map((s) => (
            <form key={s.id} action={async (fd) => { await upsertServiceArea(family.id, fd); refresh(); }} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
              <input type="hidden" name="code" value={s.code} /><input type="hidden" name="settingCodes" value={s.settingCodes || s.code} /><input type="hidden" name="unitCategories" value={s.unitCategories} />
              <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-white">{s.code}</span>
              <input name="name" defaultValue={s.name} className="w-56 bg-transparent px-1 py-0.5 text-slate-800 focus:bg-white" />
              <span className="text-slate-400">{allAssets.filter((a) => a.settingCode === (s.settingCodes.split(",")[0]?.trim() || s.code)).length} assets</span>
              <button className="text-[10px] text-slate-500 hover:text-slate-800">save</button>
              <button type="button" onClick={() => { if (confirm(`Remove setting ${s.code}?`)) deleteServiceArea(s.id, family.id).then(refresh); }} className="text-slate-300 hover:text-rose-700">✕</button>
            </form>
          ))}
          <form action={async (fd) => { await upsertServiceArea(family.id, fd); refresh(); }} className="flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2 py-1 text-xs">
            <input name="code" placeholder="CODE" required className="w-20 rounded border border-slate-300 px-1.5 py-0.5 font-mono uppercase" />
            <input name="name" placeholder="Setting name, e.g. Computed tomography" required className="w-64 rounded border border-slate-300 px-1.5 py-0.5" />
            <button className="rounded bg-rose-600 px-2 py-0.5 font-medium text-white">+ Add setting</button>
          </form>
        </div>
      </section>

      {/* ── Sites and their assets ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Sites — and the assets each one holds</h2>
            <p className="text-sm text-slate-500">Open a site to build its assets one at a time: what it is, which days, which shifts and how long, learners per shift. The agreement here is {family.name}&apos;s own.</p>
          </div>
          <button onClick={() => setAddSite((v) => !v)} className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700">{addSite ? "close" : "+ Add a site"}</button>
        </div>
        {addSite && (
          <form action={async (fd) => { const r = await addFamilySite(family.id, fd); setAddSite(false); setOpen(r.employerId); refresh(); }} className="grid gap-2 rounded-xl border border-rose-200 bg-rose-50/30 p-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <label className="block sm:col-span-2 lg:col-span-4"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">An organization already in the directory</span>
              <select name="employerId" defaultValue="" className="w-full rounded border border-slate-300 px-2 py-1"><option value="">— or create a new site below —</option>{organizations.map((o) => <option key={o.id} value={o.id}>{o.name}{o.county ? ` · ${o.county}` : ""}{o.facilityType ? ` · ${o.facilityType}` : ""}</option>)}</select></label>
            <label className="block"><span className="block text-[10px] text-slate-400">New site name</span><input name="name" className="w-full rounded border border-slate-300 px-2 py-1" /></label>
            <label className="block"><span className="block text-[10px] text-slate-400">Organization / system</span><input name="organization" className="w-full rounded border border-slate-300 px-2 py-1" /></label>
            <label className="block"><span className="block text-[10px] text-slate-400">Facility type</span><select name="facilityType" className="w-full rounded border border-slate-300 px-2 py-1">{FACILITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
            <label className="block"><span className="block text-[10px] text-slate-400">Site id (partner code)</span><input name="externalId" placeholder="H019" className="w-full rounded border border-slate-300 px-2 py-1 font-mono" /></label>
            <label className="block"><span className="block text-[10px] text-slate-400">County</span><input name="county" className="w-full rounded border border-slate-300 px-2 py-1" /></label>
            <label className="block"><span className="block text-[10px] text-slate-400">Ring</span><select name="ring" className="w-full rounded border border-slate-300 px-2 py-1">{["Core", "Ring 1", "Ring 2", "Ring 3"].map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <label className="block sm:col-span-2"><span className="block text-[10px] text-slate-400">Street address</span><input name="address" placeholder="155 Memorial Dr" className="w-full rounded border border-slate-300 px-2 py-1" /></label>
            <label className="block"><span className="block text-[10px] text-slate-400">City</span><input name="city" className="w-full rounded border border-slate-300 px-2 py-1" /></label>
            <label className="block"><span className="block text-[10px] text-slate-400">State · ZIP</span><div className="flex gap-1"><input name="state" defaultValue="NC" className="w-12 rounded border border-slate-300 px-2 py-1" /><input name="zip" placeholder="28374" className="w-full rounded border border-slate-300 px-2 py-1" /></div></label>
            <label className="block"><span className="block text-[10px] text-slate-400">Agreement for {family.name}</span><select name="agreementStatus" className="w-full rounded border border-slate-300 px-2 py-1">{AGREEMENTS.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
            <label className="block"><span className="block text-[10px] text-slate-400">Contact name</span><input name="contactName" className="w-full rounded border border-slate-300 px-2 py-1" /></label>
            <label className="block"><span className="block text-[10px] text-slate-400">Contact email</span><input name="contactEmail" type="email" className="w-full rounded border border-slate-300 px-2 py-1" /></label>
            <div className="flex items-end"><button className="rounded-lg bg-rose-600 px-3 py-1.5 font-medium text-white">Add site to {family.name}</button></div>
          </form>
        )}
        {sites.map((s) => {
          const t = assetTotals(s.assets, overrides, `${yr}-01-01`, `${yr}-12-31`);
          const isOpen = open === s.id;
          return (
            <div key={s.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <button onClick={() => setOpen(isOpen ? null : s.id)} className="min-w-0 flex-1 text-left">
                  <div className="text-base font-semibold text-slate-900">{isOpen ? "▾" : "▸"} {s.name} <span className="text-xs font-normal text-slate-400">{s.externalId ?? ""}</span></div>
                  <div className="text-xs text-slate-500">{[s.facilityType, s.county && `${s.county} County`, s.ring].filter(Boolean).join(" · ")}{(s.address || s.city) ? <> · <span className="text-slate-600">{[s.address, [s.city, s.state].filter(Boolean).join(", "), s.zip].filter(Boolean).join(" · ")}</span></> : <> · <span className="text-amber-600">no address</span></>}</div>
                  <div className="mt-1 text-sm text-slate-700">{s.assets.length === 0 ? <span className="text-slate-400">no assets yet</span> : <>{s.assets.length} assets · {t.settings.map((x) => `${x.settingCode} ${x.assets}`).join(" · ")} · <strong>{n0(t.grand.total)}</strong> shifts · <strong>{n0(t.grand.hours)}</strong> hrs in {yr}</>}</div>
                </button>
                <form action={async (fd) => { await upsertFamilySite(family.id, s.id, fd); refresh(); }} className="flex items-center gap-1 text-xs">
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">Agreement · {family.name}</span>
                  <select name="agreementStatus" defaultValue={s.agreementStatus} className={`rounded px-1.5 py-1 font-medium ${AGREEMENT[s.agreementStatus]}`}>{AGREEMENTS.map((a) => <option key={a} value={a}>{a}</option>)}</select>
                  <button className="rounded bg-slate-800 px-2 py-1 font-medium text-white">Save</button>
                </form>
                <a href={`/employers/${s.id}`} className="text-xs text-rose-700 hover:underline">site profile ↦</a>
                <button onClick={() => { if (confirm(`Remove ${s.name} from ${family.name}'s supply map? Its assets stay on the site profile.`)) startTransition(async () => { await removeFamilySite(family.id, s.id); refresh(); }); }} className="text-slate-300 hover:text-rose-700" title="remove from this job">✕</button>
              </div>
              {isOpen && (
                <div className="border-t border-slate-100 p-4">
                  <AssetBuilder employerId={s.id} siteName={s.name} siteExternalId={s.externalId} assets={s.assets} overrides={overrides.filter((o) => s.assets.some((a) => a.id === o.assetId))} settings={settingOptions} year={yr} />
                  <div className="mt-3 text-right text-xs"><a href={`/api/asset-map?institutionId=${family.institutionId}&employerId=${s.id}&year=${yr}`} className="text-rose-700 hover:underline">download this site&apos;s workbook ({yr}) ↦</a></div>
                </div>
              )}
            </div>
          );
        })}
        {sites.length === 0 && <p className="text-sm text-slate-500">No sites yet for {family.name}. Add one above.</p>}
      </section>

      <Workbook institutionId={family.institutionId} familyName={family.name} year={yr} pending={pending} onImport={(p) => startTransition(async () => { const r = await importAssetMap(family.institutionId, p); alert(`Imported ${r.assets} assets across ${r.sites} sites (${r.newSites} new), ${r.exceptions} date exceptions.`); refresh(); })} />
    </div>
  );
}

function Workbook({ institutionId, familyName, year, pending, onImport }: { institutionId: string; familyName: string; year: number; pending: boolean; onImport: (p: ParsedAssetMap) => void }) {
  const [parsed, setParsed] = useState<ParsedAssetMap | null>(null); const [name, setName] = useState<string | null>(null);
  const load = async (f: File) => { const XLSX = await import("xlsx"); const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true }); const sheets: Record<string, unknown[][]> = {}; for (const sn of wb.SheetNames) sheets[sn] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, raw: true, defval: null }); setParsed(parseAssetMapWorkbook(sheets)); setName(f.name); };
  return (
    <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-2">
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void load(f); }} className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-4">
        <div className="text-sm font-semibold text-slate-800">Or import a partner&apos;s asset map workbook</div>
        <p className="mt-1 text-xs text-slate-500">ASSET_MAP (one row per asset with its operating rule) plus, if filled in, 365_SHIFT_MAP (asset × date × shift, with hours per shift). Sites are matched by facility id or name; the file&apos;s assets replace those sites&apos; assets.</p>
        <input type="file" accept=".xlsx,.xlsm,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} className="mt-2 text-xs" />
        {parsed && <div className="mt-2 text-xs text-slate-700"><strong>{name}</strong>: {parsed.assets.length} assets · {new Set(parsed.assets.map((a) => a.facilityExternalId || a.facilityName)).size} sites · {parsed.exceptions.length} exceptions{parsed.issues.length ? ` · ⚠ ${parsed.issues.slice(0, 3).join("; ")}` : ""}<button disabled={pending || !parsed.assets.length} onClick={() => onImport(parsed)} className="ml-2 rounded bg-rose-600 px-2 py-1 font-medium text-white disabled:opacity-50">Import</button></div>}
      </div>
      <div className="rounded-xl border border-slate-200 p-4">
        <div className="text-sm font-semibold text-slate-800">Send a partner the workbook to fill in</div>
        <p className="mt-1 text-xs text-slate-500">TOTALS · ASSET_MAP · 365_SHIFT_MAP · FACILITY_TOTALS, generated from what is coded for {familyName} — so a site can correct it and send it back.</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">{[year - 1, year, year + 1].map((y) => <a key={y} href={`/api/asset-map?institutionId=${institutionId}&year=${y}`} className="rounded-lg bg-slate-800 px-3 py-1.5 font-medium text-white hover:bg-slate-700">Whole map · {y}</a>)}</div>
      </div>
    </section>
  );
}
