"use client";

// SITE CAPABILITIES, LIMITS AND AVAILABILITY (recommendation 3). Three things the old asset row blurred are
// kept apart here: the PHYSICAL resource (an asset with a seat pool), the EDUCATIONAL capability it offers
// (a population, procedure, modality or experience — several capabilities on one asset share its pool and
// never add supply), and what each number MEANS: a limit is known, explicitly unrestricted, or unknown;
// availability is the asset's schedule, unavailable, or unknown. Every substantive assertion carries its
// evidence. A case volume is an opportunity indicator, labelled as such — never learner seats.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSiteCapability, deleteSiteCapability, updateAssetLimits, type ActionResult } from "@/lib/requirementactions";
import { settingName } from "@/lib/settingPresets";

export interface CapabilityRow { id: string; assetId: string | null; settingCode: string | null; kind: string; code: string; label: string; status: string; capacityValue: number | null; capacityUnit: string | null; learnerTypes: string | null; restrictions: string | null; supervisionNote: string | null; validFrom: string | null; validTo: string | null; evidenceSource: string | null; evidenceOwner: string | null; verifiedAt: string | null; reviewBy: string | null; notes: string | null }
export interface AssetLimitRow { id: string; label: string; settingCode: string; learnersPerShift: number; limitMode: string; availabilityMode: string; dataSource: string; learnerTypes: string | null; restrictions: string | null; capabilities: string; evidenceSource: string | null; evidenceOwner: string | null; verifiedAt: string | null; reviewBy: string | null; scheduleLabel: string }

const inp = "rounded border border-slate-300 px-1.5 py-1 text-xs";
const STATUS: Record<string, string> = { supported: "bg-emerald-100 text-emerald-800", limited: "bg-amber-100 text-amber-800", unsupported: "bg-rose-100 text-rose-800", unknown: "bg-slate-100 text-slate-600" };
const LIMIT: Record<string, string> = { known: "known limit", unrestricted: "explicitly unrestricted by this field", unknown: "unknown — not asked" };
const AVAIL: Record<string, string> = { specific: "the asset's own schedule", unavailable: "unavailable to students", unknown: "unknown" };
const evidence = (r: { evidenceSource: string | null; evidenceOwner: string | null; verifiedAt: string | null; reviewBy: string | null }) => r.verifiedAt ? `verified ${r.verifiedAt.slice(0, 10)}${r.evidenceOwner ? ` by ${r.evidenceOwner}` : ""}${r.evidenceSource ? ` (${r.evidenceSource})` : ""}${r.reviewBy ? ` · review by ${r.reviewBy.slice(0, 10)}` : ""}` : r.evidenceSource ? `${r.evidenceSource} — not verified` : "no evidence recorded";

export function SiteCapabilityPanel({ employerId, capabilities, assets }: { employerId: string; capabilities: CapabilityRow[]; assets: AssetLimitRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [adding, setAdding] = useState(false);
  const [editAsset, setEditAsset] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>, then?: () => void) => start(async () => { const r = await fn(); setResult(r); if (r.ok) { then?.(); router.refresh(); } });
  const assetLabel = (id: string | null) => (id ? assets.find((a) => a.id === id)?.label ?? "asset" : "site-wide");
  return (
    <div className="space-y-4 text-xs">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Educational capabilities <span className="font-normal text-slate-400">— populations, procedures, modalities and experiences this site offers, with limits and evidence</span></h3>
          <button type="button" onClick={() => { setAdding((v) => !v); setResult(null); }} className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50">{adding ? "close" : "+ capability"}</button>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-500">A capability on an asset shares that asset&apos;s seat pool; it never adds seats. A case volume is an opportunity indicator, not a guarantee each learner completes cases.</p>
        {adding && <CapabilityForm employerId={employerId} assets={assets} onDone={() => setAdding(false)} run={run} pending={pending} />}
        <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {capabilities.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">{c.kind}</span>
              <span className="font-medium text-slate-800">{c.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS[c.status] ?? STATUS.unknown}`}>{c.status}</span>
              <span className="text-slate-500">{assetLabel(c.assetId)}{c.settingCode ? ` · ${c.settingCode}` : ""}</span>
              {c.capacityValue != null && <span className="text-slate-600">{c.capacityValue} {c.capacityUnit}</span>}
              {c.learnerTypes && <span className="text-slate-500">for: {c.learnerTypes}</span>}
              {c.restrictions && <span className="text-amber-700">limits: {c.restrictions}</span>}
              {(c.validFrom || c.validTo) && <span className="text-slate-500">{c.validFrom?.slice(0, 10) ?? "…"} → {c.validTo?.slice(0, 10) ?? "…"}</span>}
              <span className="text-[11px] text-slate-400">{evidence(c)}</span>
              <button type="button" onClick={() => { if (confirm(`Remove ${c.label}?`)) start(async () => { await deleteSiteCapability(c.id, employerId); router.refresh(); }); }} className="ml-auto text-slate-400 hover:text-rose-700">remove</button>
            </li>
          ))}
          {capabilities.length === 0 && <li className="px-3 py-2 text-slate-400">No capabilities recorded beyond the assets&apos; settings.</li>}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-800">What each asset&apos;s numbers mean <span className="font-normal text-slate-400">— limit and availability, stated explicitly</span></h3>
        <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {assets.map((a) => (
            <li key={a.id} className="px-3 py-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-800">{a.label}</span><span className="text-slate-500">{a.settingCode} · {settingName(a.settingCode)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${a.limitMode === "known" ? "bg-emerald-100 text-emerald-800" : a.limitMode === "unrestricted" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800"}`}>{a.limitMode === "known" ? `${a.learnersPerShift} learner${a.learnersPerShift === 1 ? "" : "s"} per shift` : LIMIT[a.limitMode]}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${a.availabilityMode === "specific" ? "bg-emerald-100 text-emerald-800" : a.availabilityMode === "unavailable" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>{AVAIL[a.availabilityMode] ?? a.availabilityMode}{a.availabilityMode === "specific" ? `: ${a.scheduleLabel}` : ""}</span>
                {a.learnerTypes && <span className="text-slate-500">for: {a.learnerTypes}</span>}{a.restrictions && <span className="text-amber-700">limits: {a.restrictions}</span>}
                <span className="text-[11px] text-slate-400">{a.dataSource === "VERIFIED" ? "verified" : a.dataSource === "GAP" ? "gap" : "estimate"} · {evidence(a)}</span>
                <button type="button" onClick={() => { setEditAsset(editAsset === a.id ? null : a.id); setResult(null); }} className="ml-auto text-slate-600 hover:text-rose-700">{editAsset === a.id ? "close" : "edit meaning"}</button>
              </div>
              {editAsset === a.id && (
                <form action={(fd) => run(() => updateAssetLimits(a.id, fd), () => setEditAsset(null))} className="mt-2 grid gap-2 border-t border-slate-100 pt-2 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Learner limit</span><select name="limitMode" defaultValue={a.limitMode} className={inp}>{Object.entries(LIMIT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Learners per shift</span><input name="learnersPerShift" type="number" min="0" step="1" defaultValue={a.learnersPerShift} className={`${inp} w-full text-right`} /></label>
                  <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Availability</span><select name="availabilityMode" defaultValue={a.availabilityMode} className={inp}>{Object.entries(AVAIL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Evidence for the limit</span><select name="dataSource" defaultValue={a.dataSource === "VERIFIED" ? "VERIFIED" : "ESTIMATE"} className={inp}><option value="VERIFIED">verified with the site</option><option value="ESTIMATE">estimate</option></select></label>
                  <label className="block sm:col-span-2"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Learner / program types permitted</span><input name="learnerTypes" defaultValue={a.learnerTypes ?? ""} className={`${inp} w-full`} placeholder="e.g. second-year radiography only" /></label>
                  <label className="block sm:col-span-2"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Restricted activities / supervision dependencies</span><input name="restrictions" defaultValue={a.restrictions ?? ""} className={`${inp} w-full`} placeholder="e.g. observation only in trauma bays; needs a CST present" /></label>
                  <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Timezone</span><input name="timezone" placeholder="America/New_York" className={`${inp} w-full`} /></label>
                  <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Source</span><input name="evidenceSource" defaultValue={a.evidenceSource ?? ""} className={`${inp} w-full`} /></label>
                  <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Owner</span><input name="evidenceOwner" defaultValue={a.evidenceOwner ?? ""} className={`${inp} w-full`} /></label>
                  <span className="flex gap-1"><label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Verified</span><input name="verifiedAt" type="date" defaultValue={a.verifiedAt?.slice(0, 10) ?? ""} className={inp} /></label><label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Review by</span><input name="reviewBy" type="date" defaultValue={a.reviewBy?.slice(0, 10) ?? ""} className={inp} /></label></span>
                  <input type="hidden" name="capabilities" value={a.capabilities} readOnly />
                  <div className="flex items-center gap-2 lg:col-span-4"><button disabled={pending} className="rounded bg-slate-800 px-2.5 py-1 font-medium text-white hover:bg-slate-700">Save</button>{result && !result.ok && <span className="text-rose-700">{result.errors.join("; ")}</span>}</div>
                </form>
              )}
            </li>
          ))}
          {assets.length === 0 && <li className="px-3 py-2 text-slate-400">No assets yet.</li>}
        </ul>
      </div>
    </div>
  );
}

function CapabilityForm({ employerId, assets, onDone, run, pending }: { employerId: string; assets: AssetLimitRow[]; onDone: () => void; run: (fn: () => Promise<ActionResult>, then?: () => void) => void; pending: boolean }) {
  const [status, setStatus] = useState("unknown");
  return (
    <form action={(fd) => run(() => saveSiteCapability(employerId, fd), onDone)} className="mt-2 grid gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Kind</span><select name="kind" className={inp}><option value="experience">experience</option><option value="population">population</option><option value="procedure">procedure</option><option value="modality">modality</option></select></label>
      <label className="block lg:col-span-2"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Capability</span><input name="label" required className={`${inp} w-full`} placeholder="e.g. pediatric radiography · laparoscopic cases · dementia care" /></label>
      <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Status</span><select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className={inp}><option value="supported">supported</option><option value="limited">limited</option><option value="unsupported">not provided</option><option value="unknown">unknown</option></select></label>
      <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">On which asset (shares its seats)</span><select name="assetId" className={inp}><option value="">site-wide</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
      <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Setting code</span><input name="settingCode" className={`${inp} w-full`} placeholder="e.g. GEN" /></label>
      <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Capacity (its own basis)</span><span className="flex gap-1"><input name="capacityValue" type="number" min="0" step="any" className={`${inp} w-20 text-right`} /><select name="capacityUnit" className={inp}><option value="">— unit —</option><option value="cases-per-year">cases per year</option><option value="cases-per-day">cases per day</option><option value="learners-at-once">learners at once</option><option value="shifts-per-week">shifts per week</option></select></span></label>
      {status === "limited" && <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">How limited</span><input name="restrictions" className={`${inp} w-full`} placeholder="seasonal · by arrangement · observation only" /></label>}
      <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Learner types permitted</span><input name="learnerTypes" className={`${inp} w-full`} /></label>
      <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Supervision dependency</span><input name="supervisionNote" className={`${inp} w-full`} placeholder="e.g. needs an RT(R) present" /></label>
      <span className="flex gap-1"><label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">From</span><input name="validFrom" type="date" className={inp} /></label><label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">To</span><input name="validTo" type="date" className={inp} /></label></span>
      <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Evidence source</span><input name="evidenceSource" className={`${inp} w-full`} placeholder="site visit, email from …" /></label>
      <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Owner</span><input name="evidenceOwner" className={`${inp} w-full`} /></label>
      <span className="flex gap-1"><label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Verified</span><input name="verifiedAt" type="date" className={inp} /></label><label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Review by</span><input name="reviewBy" type="date" className={inp} /></label></span>
      <div className="flex items-center gap-2 lg:col-span-4"><button disabled={pending} className="rounded bg-slate-800 px-2.5 py-1 font-medium text-white hover:bg-slate-700">Save capability</button><button type="button" onClick={onDone} className="text-slate-500 hover:text-rose-700">cancel</button></div>
    </form>
  );
}
