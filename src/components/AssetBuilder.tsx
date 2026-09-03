"use client";

// Build a site's physical assets one at a time, and read each one at a glance:
//   WHAT it is (setting · asset type · number)
//   WHICH DAYS it runs (seven toggles)
//   WHICH SHIFTS it runs and how long each is (Day / Evening / Night, start + hours)
//   the LEARNER rule (learners per shift), and what that adds up to per week and per year.
// Presets fill a new asset in one click; "add N more like this" copies a room.

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assetTotals, blocksOn, overrideIndex, overrideKey, isoRange, type AssetLite, type AssetDayOverride } from "@/lib/assetmap";
import { saveClinicalAsset, duplicateClinicalAsset, deleteClinicalAsset, setAssetDays, setAssetDay, type AssetInput } from "@/lib/actions";

export interface SettingOption { code: string; name: string; assetType?: string }
export interface BuilderAsset extends AssetLite { notes?: string | null; exceptions?: number }
type Block = "Day" | "Evening" | "Night";
interface Draft { externalId: string; settingCode: string; setting: string; assetType: string; assetNumber: number; days: string[]; blocks: Record<Block, { on: boolean; start: string; hours: number }>; serves: string; learnersPerShift: number; preceptorsPerShift: number; dataSource: string; notes: string }

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BLOCKS: Block[] = ["Day", "Evening", "Night"];
const n0 = (v: number) => Math.round(v).toLocaleString();
const fmtD = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const endOf = (start: string, hours: number) => { const [h, m] = start.split(":").map(Number); const e = ((h * 60 + m + Math.round(hours * 60)) % 1440 + 1440) % 1440; return `${String(Math.floor(e / 60)).padStart(2, "0")}:${String(e % 60).padStart(2, "0")}`; };
const dayLabel = (days: string[]) => { const idx = days.map((d) => DAYS.indexOf(d)).filter((i) => i >= 0).sort((a, b) => a - b); if (idx.length === 7) return "Every day"; if (idx.length === 0) return "No days"; const wk = [0, 1, 2, 3, 4]; if (idx.length === 5 && wk.every((i) => idx.includes(i))) return "Mon–Fri"; if (idx.length === 2 && idx.includes(5) && idx.includes(6)) return "Sat–Sun"; return idx.map((i) => DAYS[i]).join(", "); };

const PRESETS: { label: string; hint: string; days: string[]; blocks: Draft["blocks"] }[] = [
  { label: "24 × 7 — three 8-hour shifts", hint: "Day 07–15 · Evening 15–23 · Night 23–07, every day", days: DAYS, blocks: { Day: { on: true, start: "07:00", hours: 8 }, Evening: { on: true, start: "15:00", hours: 8 }, Night: { on: true, start: "23:00", hours: 8 } } },
  { label: "Weekday day — one 8-hour shift", hint: "Day 07–15, Monday to Friday", days: DAYS.slice(0, 5), blocks: { Day: { on: true, start: "07:00", hours: 8 }, Evening: { on: false, start: "15:00", hours: 8 }, Night: { on: false, start: "23:00", hours: 8 } } },
  { label: "Weekday day + evening", hint: "Day 07–15 and Evening 15–23, Monday to Friday", days: DAYS.slice(0, 5), blocks: { Day: { on: true, start: "07:00", hours: 8 }, Evening: { on: true, start: "15:00", hours: 8 }, Night: { on: false, start: "23:00", hours: 8 } } },
  { label: "7-day, two 12-hour shifts", hint: "Day 07–19 and Night 19–07, every day", days: DAYS, blocks: { Day: { on: true, start: "07:00", hours: 12 }, Evening: { on: false, start: "15:00", hours: 8 }, Night: { on: true, start: "19:00", hours: 12 } } },
];

const toDraft = (a: BuilderAsset): Draft => {
  const on = a.shiftBlocks.split(",").map((s) => s.trim());
  return { externalId: a.externalId ?? "", settingCode: a.settingCode, setting: a.setting, assetType: a.assetType, assetNumber: a.assetNumber, days: a.days.split(",").map((s) => s.trim()).filter(Boolean),
    blocks: { Day: { on: on.includes("Day"), start: a.dayStart ?? "07:00", hours: a.dayHours ?? a.hoursPerShift }, Evening: { on: on.includes("Evening"), start: a.eveningStart ?? "15:00", hours: a.eveningHours ?? a.hoursPerShift }, Night: { on: on.includes("Night"), start: a.nightStart ?? "23:00", hours: a.nightHours ?? a.hoursPerShift } },
    serves: a.serves ?? "", learnersPerShift: a.learnersPerShift, preceptorsPerShift: a.preceptorsPerShift, dataSource: a.dataSource, notes: a.notes ?? "" };
};
const toInput = (d: Draft): AssetInput => ({ externalId: d.externalId || null, settingCode: d.settingCode, setting: d.setting, assetType: d.assetType, assetNumber: d.assetNumber, days: d.days, blocks: BLOCKS.filter((b) => d.blocks[b].on).map((b) => ({ block: b, start: d.blocks[b].start, hours: d.blocks[b].hours })), serves: d.serves || null, learnersPerShift: d.learnersPerShift, preceptorsPerShift: d.preceptorsPerShift, dataSource: d.dataSource, notes: d.notes || null });
const weekly = (d: Draft) => { const on = BLOCKS.filter((b) => d.blocks[b].on); const shifts = d.days.length * on.length; const hours = d.days.length * on.reduce((n, b) => n + d.blocks[b].hours, 0); return { shifts, hours, learnerShifts: shifts * d.learnersPerShift, learnerHours: hours * d.learnersPerShift }; };

export function AssetBuilder({ employerId, siteName, siteExternalId, assets, overrides, settings, year, compact = false }: {
  employerId: string; siteName: string; siteExternalId?: string | null; assets: BuilderAsset[]; overrides: AssetDayOverride[]; settings: SettingOption[]; year: number; compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [adding, setAdding] = useState<Draft | null>(null);
  const [yearOpen, setYearOpen] = useState<string | null>(null);
  const [yr, setYr] = useState(year);
  const [closure, setClosure] = useState({ from: `${year}-12-24`, to: `${year}-12-26`, scope: "all", note: "Holiday closure" });
  const ov = useMemo(() => overrideIndex(overrides), [overrides]);
  const refresh = () => router.refresh();
  const draftOf = (a: BuilderAsset) => drafts[a.id] ?? toDraft(a);
  const setDraft = (id: string, patch: Partial<Draft> | ((d: Draft) => Draft)) => setDrafts((p) => { const cur = p[id] ?? toDraft(assets.find((a) => a.id === id)!); return { ...p, [id]: typeof patch === "function" ? patch(cur) : { ...cur, ...patch } }; });
  const isDirty = (a: BuilderAsset) => JSON.stringify(drafts[a.id] ?? null) !== null && JSON.stringify(drafts[a.id]) !== JSON.stringify(toDraft(a));
  const save = (id: string | null, d: Draft) => startTransition(async () => { const input = toInput(d); if (!input.externalId) input.externalId = nextCode(d.settingCode); await saveClinicalAsset(employerId, id, input); if (id) setDrafts((p) => { const n = { ...p }; delete n[id]; return n; }); else setAdding(null); refresh(); });
  const nextCode = (settingCode: string) => `${siteExternalId ?? siteName.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase()}-${settingCode}-${String(assets.filter((a) => a.settingCode === settingCode).length + 1).padStart(2, "0")}`;
  const bySetting = useMemo(() => { const m = new Map<string, BuilderAsset[]>(); for (const a of assets) { const l = m.get(a.settingCode) ?? []; l.push(a); m.set(a.settingCode, l); } return m; }, [assets]);
  const settingName = (code: string) => settings.find((s) => s.code === code)?.name ?? assets.find((a) => a.settingCode === code)?.setting ?? code;
  const yearTotals = useMemo(() => assetTotals(assets, overrides, `${yr}-01-01`, `${yr}-12-31`), [assets, overrides, yr]);

  const ctx: CardCtx = { settings, nextCode, pending, save, setAdding, setDrafts, refresh, yearOpen, setYearOpen, employerId, ov, yr, startTransition, overrides, setDraft, isDirty };

  return (
    <div className="space-y-3">
      {/* Site summary + year */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-2.5 text-sm">
        <div><strong>{assets.length}</strong> physical asset{assets.length === 1 ? "" : "s"} at {siteName}{assets.length > 0 && <> · <strong>{n0(yearTotals.grand.total)}</strong> shifts and <strong>{n0(yearTotals.grand.hours)}</strong> hours available in {yr} · {yearTotals.settings.map((s) => `${s.settingCode} ${s.assets}`).join(" · ")}</>}</div>
        <label className="text-xs text-slate-600">Year <select value={yr} onChange={(e) => setYr(Number(e.target.value))} className="ml-1 rounded border border-slate-300 px-2 py-1">{[year - 1, year, year + 1, year + 2].map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
      </div>

      {/* Assets, grouped by setting */}
      {[...bySetting.entries()].map(([code, list]) => (
        <div key={code} className="space-y-2">
          <div className="flex items-baseline gap-2"><span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-white">{code}</span><span className="text-sm font-semibold text-slate-800">{settingName(code)}</span><span className="text-xs text-slate-500">· {list.length} asset{list.length === 1 ? "" : "s"}</span></div>
          {list.map((a) => <AssetCard key={a.id} a={a} d={draftOf(a)} isNew={false} ctx={ctx} />)}
        </div>
      ))}
      {assets.length === 0 && !adding && <p className="text-sm text-slate-500">No assets yet. Add the first room, unit or machine below — a preset fills in the shift structure, then adjust the days and shifts.</p>}

      {/* Add an asset */}
      {adding ? <AssetCard a={null} d={adding} isNew ctx={ctx} /> : (
        <div className="rounded-xl border border-dashed border-slate-300 p-3">
          <div className="text-xs font-semibold text-slate-700">Add an asset — start from a shift structure:</div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {PRESETS.map((p) => <button key={p.label} onClick={() => { const s = settings[0]; setAdding({ externalId: "", settingCode: s?.code ?? "GEN", setting: s?.name ?? "General", assetType: s?.assetType ?? "", assetNumber: (bySetting.get(s?.code ?? "GEN")?.length ?? 0) + 1, days: [...p.days], blocks: JSON.parse(JSON.stringify(p.blocks)), serves: "", learnersPerShift: 1, preceptorsPerShift: 1, dataSource: "ESTIMATE", notes: "" }); }} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-left text-xs hover:border-rose-300 hover:bg-rose-50/40"><span className="block font-medium text-slate-800">{p.label}</span><span className="block text-[10px] text-slate-500">{p.hint}</span></button>)}
          </div>
        </div>
      )}

      {/* Closures across a range */}
      {!compact && assets.length > 0 && (
        <details className="rounded-xl border border-slate-200 p-3 text-xs">
          <summary className="cursor-pointer font-medium text-slate-700">Close assets for a date range (holiday, maintenance) — exceptions to the shift structure</summary>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="block"><span className="block text-[10px] text-slate-400">From</span><input type="date" value={closure.from} onChange={(e) => setClosure({ ...closure, from: e.target.value })} className="rounded border border-slate-300 px-2 py-1" /></label>
            <label className="block"><span className="block text-[10px] text-slate-400">To</span><input type="date" value={closure.to} onChange={(e) => setClosure({ ...closure, to: e.target.value })} className="rounded border border-slate-300 px-2 py-1" /></label>
            <label className="block"><span className="block text-[10px] text-slate-400">Which assets</span><select value={closure.scope} onChange={(e) => setClosure({ ...closure, scope: e.target.value })} className="rounded border border-slate-300 px-2 py-1"><option value="all">all {assets.length}</option>{[...bySetting.keys()].map((c) => <option key={c} value={c}>{c} only</option>)}</select></label>
            <label className="block"><span className="block text-[10px] text-slate-400">Note</span><input value={closure.note} onChange={(e) => setClosure({ ...closure, note: e.target.value })} className="rounded border border-slate-300 px-2 py-1" /></label>
            <button disabled={pending} onClick={() => startTransition(async () => { const ids = (closure.scope === "all" ? assets : bySetting.get(closure.scope) ?? []).map((a) => a.id); await setAssetDays(ids, closure.from, closure.to, "", closure.note); refresh(); })} className="rounded-lg bg-slate-800 px-3 py-1.5 font-medium text-white">Close those days</button>
            <button disabled={pending} onClick={() => startTransition(async () => { const ids = (closure.scope === "all" ? assets : bySetting.get(closure.scope) ?? []).map((a) => a.id); await setAssetDays(ids, closure.from, closure.to, null); refresh(); })} className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700">Re-open (remove exceptions)</button>
          </div>
        </details>
      )}
    </div>
  );
}

// Hoisted out of AssetBuilder so React keeps the same component identity across
// renders — an inline component would remount on every keystroke and drop focus.
interface CardCtx {
  settings: SettingOption[]; nextCode: (settingCode: string) => string; pending: boolean; save: (id: string | null, d: Draft) => void;
  setAdding: React.Dispatch<React.SetStateAction<Draft | null>>; setDrafts: React.Dispatch<React.SetStateAction<Record<string, Draft>>>; setDraft: (id: string, patch: Partial<Draft> | ((d: Draft) => Draft)) => void;
  refresh: () => void; yearOpen: string | null; setYearOpen: (id: string | null) => void; employerId: string; ov: Map<string, AssetDayOverride>; yr: number;
  startTransition: (cb: () => Promise<void>) => void; overrides: AssetDayOverride[]; isDirty: (a: BuilderAsset) => boolean;
}
function AssetCard({ a, d, isNew, ctx }: { a: BuilderAsset | null; d: Draft; isNew: boolean; ctx: CardCtx }) {
  const { settings, nextCode, pending, save, setAdding, setDrafts, refresh, yearOpen, setYearOpen, employerId, ov, yr, startTransition, overrides, setDraft, isDirty } = ctx;
  const id = a?.id ?? "new";
  const set = (patch: Partial<Draft> | ((x: Draft) => Draft)) => (isNew ? setAdding((p) => (p ? (typeof patch === "function" ? patch(p) : { ...p, ...patch }) : p)) : setDraft(id, patch));
  const w = weekly(d);
  const yearT = a ? assetTotals([a], overrides, `${yr}-01-01`, `${yr}-12-31`).grand : null;
  const dirty = isNew || (a ? isDirty(a) : false);
  return (
    <div className={`rounded-xl border p-4 ${isNew ? "border-rose-300 bg-rose-50/30" : dirty ? "border-amber-300 bg-amber-50/20" : "border-slate-200 bg-white"}`}>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr_1.3fr_0.9fr]">
        {/* WHAT */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">What it is</div>
          <label className="block text-xs"><span className="block text-[10px] text-slate-400">Setting</span>
            <select value={d.settingCode} onChange={(e) => { const s = settings.find((x) => x.code === e.target.value); set({ settingCode: e.target.value, setting: s?.name ?? d.setting, assetType: d.assetType || s?.assetType || "" }); }} className="w-full rounded border border-slate-300 px-2 py-1">
              {settings.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
              {!settings.some((s) => s.code === d.settingCode) && <option value={d.settingCode}>{d.settingCode} · {d.setting}</option>}
            </select></label>
          <label className="block text-xs"><span className="block text-[10px] text-slate-400">Asset type</span><input value={d.assetType} onChange={(e) => set({ assetType: e.target.value })} placeholder="Fixed radiographic room" className="w-full rounded border border-slate-300 px-2 py-1" /></label>
          <div className="flex gap-2">
            <label className="block text-xs"><span className="block text-[10px] text-slate-400">Number</span><input type="number" min={1} value={d.assetNumber} onChange={(e) => set({ assetNumber: Number(e.target.value) || 1 })} className="w-16 rounded border border-slate-300 px-2 py-1" /></label>
            <label className="block flex-1 text-xs"><span className="block text-[10px] text-slate-400">Asset id</span><input value={d.externalId} onChange={(e) => set({ externalId: e.target.value })} placeholder={nextCode(d.settingCode)} className="w-full rounded border border-slate-300 px-2 py-1 font-mono" /></label>
          </div>
          <label className="block text-xs"><span className="block text-[10px] text-slate-400">Serves (populations / case mix)</span><input value={d.serves} onChange={(e) => set({ serves: e.target.value })} placeholder="Routine, pediatric, geriatric" className="w-full rounded border border-slate-300 px-2 py-1" /></label>
        </div>
        {/* WHICH DAYS */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Days of the week it runs</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {DAYS.map((day) => { const on = d.days.includes(day); return <button key={day} type="button" onClick={() => set({ days: on ? d.days.filter((x) => x !== day) : [...d.days, day] })} className={`w-11 rounded-md py-1.5 text-xs font-semibold ${on ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-400 line-through"}`}>{day}</button>; })}
          </div>
          <div className="mt-1.5 text-sm font-medium text-slate-800">{dayLabel(d.days)} <span className="text-xs font-normal text-slate-500">· {d.days.length} day{d.days.length === 1 ? "" : "s"} a week</span></div>
          <div className="mt-2 flex gap-1 text-[10px]">
            <button type="button" onClick={() => set({ days: [...DAYS] })} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">every day</button>
            <button type="button" onClick={() => set({ days: DAYS.slice(0, 5) })} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">Mon–Fri</button>
            <button type="button" onClick={() => set({ days: DAYS.slice(5) })} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">weekends</button>
          </div>
        </div>
        {/* WHICH SHIFTS */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Shifts it runs — start and length</div>
          <div className="mt-1.5 space-y-1">
            {BLOCKS.map((b) => { const s = d.blocks[b]; return (
              <div key={b} className={`flex flex-wrap items-center gap-2 rounded-md px-2 py-1 ${s.on ? "bg-sky-50" : "bg-slate-50"}`}>
                <label className="inline-flex w-24 items-center gap-1.5 text-xs font-semibold text-slate-800"><input type="checkbox" checked={s.on} onChange={(e) => set((x) => ({ ...x, blocks: { ...x.blocks, [b]: { ...s, on: e.target.checked } } }))} />{b}</label>
                <input type="time" value={s.start} disabled={!s.on} onChange={(e) => set((x) => ({ ...x, blocks: { ...x.blocks, [b]: { ...s, start: e.target.value || s.start } } }))} className="rounded border border-slate-300 px-1.5 py-0.5 text-xs disabled:opacity-40" />
                <input type="number" min={0.5} step={0.5} value={s.hours} disabled={!s.on} onChange={(e) => set((x) => ({ ...x, blocks: { ...x.blocks, [b]: { ...s, hours: Number(e.target.value) || s.hours } } }))} className="w-14 rounded border border-slate-300 px-1.5 py-0.5 text-right text-xs disabled:opacity-40" /><span className="text-[10px] text-slate-500">hrs</span>
                <span className={`ml-auto text-xs ${s.on ? "font-medium text-sky-800" : "text-slate-300"}`}>{s.on ? `${s.start}–${endOf(s.start, s.hours)}` : "off"}</span>
              </div>
            ); })}
          </div>
          <div className="mt-1.5 text-sm font-medium text-slate-800">{BLOCKS.filter((b) => d.blocks[b].on).length} shift{BLOCKS.filter((b) => d.blocks[b].on).length === 1 ? "" : "s"} a day <span className="text-xs font-normal text-slate-500">· {BLOCKS.filter((b) => d.blocks[b].on).reduce((n, b) => n + d.blocks[b].hours, 0)} hours a day</span></div>
        </div>
        {/* LEARNER RULE + TOTALS */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Learner rule</div>
          <label className="block text-xs"><span className="block text-[10px] text-slate-400">Learners per shift</span><input type="number" min={0} value={d.learnersPerShift} onChange={(e) => set({ learnersPerShift: Number(e.target.value) || 0 })} className="w-20 rounded border border-slate-300 px-2 py-1" /></label>
          <label className="block text-xs"><span className="block text-[10px] text-slate-400">Preceptors per shift</span><input type="number" min={0} value={d.preceptorsPerShift} onChange={(e) => set({ preceptorsPerShift: Number(e.target.value) || 0 })} className="w-20 rounded border border-slate-300 px-2 py-1" /></label>
          <label className="block text-xs"><span className="block text-[10px] text-slate-400">Data source</span><select value={d.dataSource} onChange={(e) => set({ dataSource: e.target.value })} className="rounded border border-slate-300 px-2 py-1">{["VERIFIED", "ESTIMATE", "GAP"].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <div className="rounded-md bg-slate-800 px-2.5 py-2 text-xs text-white">
            <div><strong>{n0(w.shifts)}</strong> shifts · <strong>{n0(w.hours)}</strong> hrs a week</div>
            <div className="text-slate-300">{n0(w.learnerShifts)} learner-shifts · {n0(w.learnerHours)} learner-hrs a week</div>
            {yearT && <div className="mt-1 border-t border-slate-600 pt-1 text-slate-300">{yr}: <strong className="text-white">{n0(yearT.total)}</strong> shifts · <strong className="text-white">{n0(yearT.hours)}</strong> hrs{a?.exceptions ? ` · ${a.exceptions} exception day${a.exceptions === 1 ? "" : "s"}` : ""}</div>}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isNew ? (
          <>
            <button disabled={pending} onClick={() => save(null, d)} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">+ Add this asset</button>
            <button onClick={() => setAdding(null)} className="text-xs text-slate-500">cancel</button>
          </>
        ) : (
          <>
            <button disabled={pending || !dirty} onClick={() => save(id, d)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${dirty ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-400"}`}>{dirty ? "Save changes" : "Saved"}</button>
            {dirty && <button onClick={() => setDrafts((p) => { const n = { ...p }; delete n[id]; return n; })} className="text-xs text-slate-500">discard</button>}
            <span className="mx-1 text-slate-200">|</span>
            <button disabled={pending} onClick={() => { const n = Number(prompt("Add how many more assets like this one?", "1")); if (n > 0) startTransition(async () => { await duplicateClinicalAsset(id, n); refresh(); }); }} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">+ add more like this</button>
            <button onClick={() => setYearOpen(yearOpen === id ? null : id)} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">{yearOpen === id ? "hide" : "show"} every day of {yr}</button>
            <button disabled={pending} onClick={() => { if (confirm(`Delete ${d.externalId || d.assetType}?`)) startTransition(async () => { await deleteClinicalAsset(id, employerId); refresh(); }); }} className="ml-auto text-xs text-slate-300 hover:text-rose-700">delete</button>
          </>
        )}
      </div>
      {a && yearOpen === id && <YearStrip a={a} yr={yr} ov={ov} pending={pending} onToggle={(iso, cur) => startTransition(async () => { await setAssetDay(id, iso, cur); refresh(); })} />}
    </div>
  );
}

function YearStrip({ a, yr, ov, pending, onToggle }: { a: BuilderAsset; yr: number; ov: Map<string, AssetDayOverride>; pending: boolean; onToggle: (iso: string, blocks: string | null) => void }) {
  const months = Array.from({ length: 12 }, (_, m) => m);
  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-2">
      <div className="mb-1 flex flex-wrap items-center gap-3 text-[10px] text-slate-500"><span className="font-semibold uppercase tracking-wide">{yr}, every day</span><span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-slate-200" /> closed</span><span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-sky-300" /> 1 shift</span><span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-sky-500" /> 2</span><span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-sky-800" /> 3</span><span>· click a day to close or re-open it</span></div>
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {months.map((m) => { const first = `${yr}-${String(m + 1).padStart(2, "0")}-01`; const last = new Date(Date.UTC(yr, m + 1, 0)).toISOString().slice(0, 10); const lead = (new Date(first + "T00:00:00Z").getUTCDay() + 6) % 7; return (
          <div key={m} className="rounded bg-white p-1.5">
            <div className="text-[10px] font-semibold text-slate-600">{new Date(first + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</div>
            <div className="mt-0.5 grid grid-cols-7 gap-px">
              {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
              {[...isoRange(first, last)].map((iso) => { const o = ov.get(overrideKey(a.id, iso)); const n = blocksOn(a, iso, o).length; const color = n === 0 ? "bg-slate-200" : n === 1 ? "bg-sky-300" : n === 2 ? "bg-sky-500" : "bg-sky-800"; return <button key={iso} disabled={pending} title={`${fmtD(iso)} · ${n ? blocksOn(a, iso, o).join(", ") : "closed"}${o ? " (exception)" : ""}`} onClick={() => onToggle(iso, o ? null : "")} className={`h-3 w-full ${color} ${o ? "ring-1 ring-rose-500" : ""}`} />; })}
            </div>
          </div>
        ); })}
      </div>
    </div>
  );
}
